#!/usr/bin/env ruby
# CLI for indexing changed files to Qdrant. Used by Guard.
# Usage: ruby scripts/guard/index_changed.rb <path1> [path2...]
#
# Env: QDRANT_URL (default: http://localhost:6333), EMBEDDER_MODULE (optional)

require "bundler/setup"
require "dotenv"
require "digest"
require "fileutils"
require "pathname"

Dotenv.load

PROJECT_ROOT = Pathname(__FILE__).expand_path.join("../..").to_s
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 100
DEFAULT_VECTOR_SIZE = 384

begin
  require "qdrant"
rescue LoadError
  warn "[guard] qdrant-ruby gem not found. Run: bundle install"
  exit 1
end

def chunk_text(text)
  chunks = []
  start = 0
  while start < text.length
    fin = [start + CHUNK_SIZE, text.length].min
    chunks << text[start...fin]
    start += CHUNK_SIZE - CHUNK_OVERLAP
  end
  chunks.empty? ? [""] : chunks
end

def hash_id(seed)
  Digest::SHA256.hexdigest(seed)[0, 36]
end

def placeholder_embed(texts)
  warn "[file-watcher] No embedder configured. Set EMBEDDER_MODULE env to a Ruby file that defines embed(texts) -> Array<Array<Float>>"
  texts.map { [0.0] * DEFAULT_VECTOR_SIZE }
end

def get_embedder
  return @embedder_fn if defined?(@embedder_fn) && @embedder_fn

  path = ENV["EMBEDDER_MODULE"]
  if path
    full_path = File.expand_path(path, PROJECT_ROOT)
    if File.exist?(full_path)
      load full_path
      @embedder_fn = method(:embed) if respond_to?(:embed, true)
    end
  end
  @embedder_fn ||= method(:placeholder_embed)
end

def index_to_qdrant(paths, event_type, options, project_root)
  url = options[:url] || ENV["QDRANT_URL"] || "http://localhost:6333"
  collection = options[:collection] || "codebase"
  vector_size = options[:vector_size] || DEFAULT_VECTOR_SIZE

  client = Qdrant::Client.new(url: url)

  paths.each do |p|
    absolute_path = File.expand_path(p, project_root)
    relative_path = Pathname(absolute_path).relative_path_from(project_root).to_s.tr(File::SEPARATOR, "/")

    if event_type == "unlink"
      begin
        client.points.delete(
          collection_name: collection,
          filter: {
            must: [{ key: "source", match: { value: relative_path } }]
          },
          wait: true
        )
        puts "[file-watcher] Deleted from index: #{relative_path}"
      rescue => e
        warn "[file-watcher] Failed to delete #{relative_path} from Qdrant: #{e.message}"
      end
      next
    end

    content = begin
      File.read(absolute_path, encoding: "UTF-8")
    rescue => e
      warn "[file-watcher] Failed to read #{relative_path}: #{e.message}"
      next
    end

    chunks = chunk_text(content)
    embedder = get_embedder
    vectors = embedder.call(chunks)

    if vectors.any? { |v| v.size != vector_size }
      warn "[file-watcher] Embedder returned wrong vector size for #{relative_path}, expected #{vector_size}"
      next
    end

    points = chunks.each_with_index.map do |chunk, i|
      {
        id: hash_id("#{relative_path}:#{i}"),
        vector: vectors[i],
        payload: {
          source: relative_path,
          content: chunk,
          chunk_index: i
        }
      }
    end

    begin
      colls = client.collections.list
      list = colls["result"] || colls[:result] || {}
      cols = list["collections"] || list[:collections] || []
      names = cols.map { |c| c["name"] || c[:name] }.compact
      unless names.include?(collection)
        client.collections.create(
          collection_name: collection,
          vectors: { size: vector_size, distance: "Cosine" }
        )
      end
    rescue => e
      # Collection may already exist
      raise e unless e.message.to_s.include?("already exists") || e.message.to_s.include?("AlreadyExists")
    end

    begin
      client.points.upsert(
        collection_name: collection,
        points: points,
        wait: true
      )
      puts "[file-watcher] Indexed #{relative_path} (#{chunks.size} chunks)"
    rescue => e
      warn "[file-watcher] Failed to index #{relative_path}: #{e.message}"
    end
  end
end

# --- main ---

paths = ARGV.reject(&:empty?)
exit 0 if paths.empty?

options = {
  collection: "codebase",
  url: ENV["QDRANT_URL"] || "http://localhost:6333"
}

paths.each do |p|
  absolute_path = File.expand_path(p, PROJECT_ROOT)
  event_type = File.readable?(absolute_path) ? "change" : "unlink"
  index_to_qdrant([absolute_path], event_type, options, PROJECT_ROOT)
end
