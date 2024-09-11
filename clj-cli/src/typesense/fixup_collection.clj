(ns typesense.fixup-collection
  (:require [typesense.api-config :refer [typesense-config]]
            [cheshire.core :as json]
            [clojure.java.io :as io]))

(defn fixup-chunks-from-staging [input-file output-file]
  (with-open [reader (io/reader input-file)
              writer (io/writer output-file)]
    (doseq [line (line-seq reader)]
      (let [document (json/parse-string line true)
            doc_id (:doc_id document)
            chunk_index (:chunk_index document)
            updated-document (-> document
                                 (dissoc :doc_id)
                                 (assoc :doc_num doc_id)
                                 (assoc :chunk_id (str doc_id "-" chunk_index)))]
        (.write writer (str (json/generate-string updated-document) "\n"))))))

(defn fixup-phrases-from-staging [input-file output-file]
  (with-open [reader (io/reader input-file)
              writer (io/writer output-file)]
    (doseq [line (line-seq reader)]
      (let [document (json/parse-string line true)
            chunk-id (:doc_id document)
            phrase-index (:sort_order document)
            [doc_num chunk_index] (clojure.string/split chunk-id #"-")
            updated-document (-> document
                                 (dissoc :doc_id)
                                 (assoc :chunk_id chunk-id) 
                                 (assoc :id (str doc_num "-" chunk_index "-" phrase-index))
                                 )]
        (.write writer (str (json/generate-string updated-document) "\n"))))))


(comment 

  (fixup-chunks-from-staging
   "STAGING_kudos-chunks_2024-09-03_export_20240909.jsonl"
   "STAGING_kudos-chunks_2024-09-03_export_20240909_fixed.jsonl")

  
  (fixup-phrases-from-staging
   "STAGING_kudos-phrases_2024-09-03_export_20240909.jsonl"
   "STAGING_kudos-phrases_2024-09-03_export_20240909_fixed.jsonl")

  )
