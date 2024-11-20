(ns chunkr
  (:require [clojure.java.io :as io]
            [clojure.string :as str]
            [clj-http.client :as http]
            [cheshire.core :as json]
            [typesense.search :as search]
            [typesense.import-collection :refer [upsert-collection]]))

(def ^:private config
  {:api-key (System/getenv "CHUNKR_API_KEY")
   :base-url "https://api.chunkr.ai/v1"})

(defn bytes-to-hex [bytes]
  (let [hex-chars "0123456789abcdef"]
    (apply str
           (for [b bytes]
             (let [v (bit-and b 0xFF)]
               (str (get hex-chars (bit-shift-right v 4))
                    (get hex-chars (bit-and v 0x0F))))))))

(defn sha1
  "Calculate SHA1 hash of input string"
  [s]
  (let [md (java.security.MessageDigest/getInstance "SHA-1")
        bytes (.getBytes s "UTF-8")]
    (-> md
        (.digest bytes)
        bytes-to-hex)))

(defn- make-request
  "Make an authenticated request to Chunkr API"
  [method endpoint opts]
  (http/request
   (merge {:method method
           :url (str (:base-url config) endpoint)
           :headers {"Authorization" (str "Bearer " (:api-key config))
                     "Content-Type" "application/json"}
           :as :json}
          opts)))

(defn process-pdf
  "Process a PDF file using Chunkr.ai API.
   Returns a collection of chunks with text and metadata."
  [file-path]
  (let [file (io/file file-path)
        form-data {:multipart [{:name "file"
                                :content file
                                :filename (.getName file)}
                               {:name "chunk_size"
                                :content "1000"}]}
        response (make-request :post "/process" form-data)]
    (get-in response [:body :chunks])))

(defn  markdown-content [chunks]
  (let [content (->> chunks
                     (mapcat :segments)
                     (map #(get % :markdown "")) ;; Use empty string as default if :markdown is missing
                     str/join)]
    content))

(defn chunks->typesense-docs
  "Convert Chunkr chunks to Typesense document format"
  [chunks doc-num]
  (map-indexed
   (fn [idx chunk]
     (let [content (markdown-content [chunk])]
       {:id (str doc-num "-" idx)
        :doc_num doc-num
        :chunk_id (str doc-num "-" idx)
        :chunk_index idx
        :content_markdown content
        :markdown_checksum (sha1 content)
        :url (str doc-num "-" idx)
        :url_without_anchor (str doc-num "-" idx)
        :type "content"
        :language "no"
        :updated_at (quot (System/currentTimeMillis) 1000)
        :page_num (-> chunk :segments first :page_number)
        :token_count 0
        :item_priority 1}))
   chunks))

(defn process-and-save-pdf
  "Process a PDF file and import its chunks to file"
  [file-path]
  (let [chunks (process-pdf file-path)
        json-chunk-list (json/write {:chunks chunks})
        filename (str "./chunkr_data/" (-> file-path io/file .getName) ".json")]
    (io/make-parents filename)
    (spit filename json-chunk-list)))



(comment

  (def docs-collection "KUDOS_docs_2024-09-27_chunkr_test")
  (def chunks-collection "KUDOS_chunks_2024-09-27_chunkr_test")

  (def query {:collection docs-collection
              :q "*"
              :query-by "doc_num"
            ;;   :filter-by "chunkr_status:null"
              :include-fields "doc_num,chunkr_status"
              :page 1
              :per_page 1})

;;   (defn get-unchunked-docs []
;;     (let [result (search/multi-search query)]
;;       (if (:success result)
;;         result
;;         (println :error (str result)))))


;;   (get-unchunked-docs)
  (defn save-chunks-to-jsonl [chunks filename]
    (with-open [writer (io/writer filename)]
      (doseq [chunk chunks]
        (.write writer (str (json/generate-string chunk) "\n")))))
  
  (def chunks-to-import-filename "./typesense_chunks/chunks_to_import.jsonl")

  (def doc-num "27262")

  (defn test-chunks [] (slurp (str "./chunkr_data/kudos_" doc-num ".json") :encoding "UTF-8"))

  (defn chunks-json [] (json/parse-string (test-chunks) true))

  (count (:chunks (chunks-json)))

  (defn typesense-chunks []
    (chunks->typesense-docs (vec (:chunks (chunks-json))) doc-num))

  (count (typesense-chunks))

  ;; 1. process chunkr json data
  (save-chunks-to-jsonl (typesense-chunks) chunks-to-import-filename)

  (upsert-collection chunks-collection chunks-to-import-filename 100 10)

  )