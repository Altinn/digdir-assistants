(ns typesense.fixup-collection
  (:require [typesense.api-config :refer [typesense-config]]
            [cheshire.core :as json]
            [clojure.string :as str]
            [clojure.java.io :as io]
            [typesense.client :as ts]
            [typesense.api-config :refer [ts-config]]))

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

(defn fixup-phrases-from-chunkr-test [input-file output-file]
  (with-open [reader (io/reader input-file)
              writer (io/writer output-file)]
    (doseq [line (line-seq reader)]
      (let [document (json/parse-string line true)
            updated-document (-> document
                                 (dissoc :url))]
        (.write writer (str (json/generate-string updated-document) "\n"))))))

(defn translate-unknown [document]
  (when (str/starts-with? (:source_published_year document) "Unknown")
    (assoc document :source_published_year "Ukjent")))

(defn get-chunks-with-title [docs-collection chunks-collection doc-num]
  (let [result (ts/search ts-config chunks-collection
                          {:q "*"
                           :query_by "doc_num"
                           :filter_by (str "doc_num:=" doc-num)
                           :include_fields (str "chunk_id,doc_num,chunk_index,$" docs-collection "(title)")
                           :sort_by "chunk_index:asc"
                           :per_page 100})]
    (if result
      (mapv :document (:hits result))
      result)))



(defn fixup-doc-year [input-file output-file]
  (with-open [reader (io/reader input-file)
              writer (io/writer output-file)]
    (doseq [line (line-seq reader)]
      (let [document (json/parse-string line true)
            updated-document (-> document
                                 translate-unknown)]
        (when (not-empty updated-document)
          (.write writer (str (json/generate-string updated-document) "\n")))))))


(comment
  
  (def docs-collection "TEST_kudos_docs")
  (def chunks-collection "TEST_kudos_chunks")

  (get-chunks-with-title docs-collection chunks-collection "2216")

  (translate-unknown {:owner_long "Digitaliserings- og forvaltningsdepartementet",
                      :source_document_type "Tildelingsbrev",
                      :kudos_published_at "2021-12-14T13:54:39.000Z",
                      :recipient_long "Digitaliseringsdirektoratet",
                      :publisher_short "KDD",
                      :source_published_year "Unknown something something",
                      :type "Tildelingsbrev",
                      :orgs_long
                      ["Digitaliserings- og forvaltningsdepartementet"
                       "Kommunal- og distriktsdepartementet"
                       "Digitaliseringsdirektoratet"],
                      :source_published_at "2020-01-06T23:00:00.000Z",
                      :orgs_short ["DFD" "KDD" "Digdir"],
                      :title "Tildelingsbrev Digitaliseringsdirektoratet 2020",
                      :source_created_at "2021-12-14T13:48:44.000Z",
                      :updated_at 1736367290,
                      :language "no",
                      :doc_num "7024",
                      :id "7024",
                      :owner_short "DFD",
                      :source_document_url
                      "https://www.regjeringen.no/contentassets/7f9b178a808649dfad4bc4ae2401ae07/tildelingsbrev-digitaliseringsdirektoratet-2020.pdf",
                      :url_without_anchor
                      "https://www.regjeringen.no/contentassets/7f9b178a808649dfad4bc4ae2401ae07/tildelingsbrev-digitaliseringsdirektoratet-2020.pdf",
                      :uuid "c331d0ad-43a5-47af-b26f-a9ebb625905f",
                      :publisher_long "Kommunal- og distriktsdepartementet",
                      :recipient_short "Digdir",
                      :source_updated_at "2023-10-11T11:39:15.000Z"}
                     )
  (fixup-chunks-from-staging
   "STAGING_kudos-chunks_2024-09-03_export_20240909.jsonl"
   "STAGING_kudos-chunks_2024-09-03_export_20240909_fixed.jsonl")


  (fixup-phrases-from-staging
   "STAGING_kudos-phrases_2024-09-03_export_20240909.jsonl"
   "STAGING_kudos-phrases_2024-09-03_export_20240909_fixed.jsonl")

  (fixup-phrases-from-chunkr-test
   "KUDOS_phrases_2024-09-27_chunkr_test_export_20250107.jsonl"
   "KUDOS_phrases_2024-09-27_chunkr_test_export_20250107_fixed.jsonl")

  (fixup-doc-year
   "/Volumes/models/kudos_backup/snapshot_2025-01-23/KUDOS_docs_2025-01-08_export_20250123.jsonl"
   "/Volumes/models/kudos_backup/snapshot_2025-01-23/KUDOS_docs_2025-01-08_export_20250123_fixed.jsonl"
   )


  )
