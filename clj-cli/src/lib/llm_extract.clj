(ns lib.llm-extract
  (:require [wkok.openai-clojure.api :as api]
            [clj-http.client :as http]
            [cheshire.core :as json]
            [clojure.string :as str]
            [typesense.client :as ts]
            [typesense.api-config :refer [ts-config]]))

(def model-name "chocolatine-3b-instruct-dpo-revised")
(def base-url "http://localhost:1234/v1")

(defn local-chat-completion [messages]
  (api/create-chat-completion
   {:model model-name
    :messages messages
    :temperature 0.1
    :stream false
    :max_tokens 300}
   {:api-key "lm-studio"
    :api-endpoint base-url}))

(def extract-year-sys-prompt
  (str
   "Your task is to analyze the following document and determine which YEAR is relevant, if any. 
  Provide only the YEAR, or \"Unknown\" if this part of the document does not clearly indicate the YEAR.
   "))

(defn extract-relevant-year [text]
  (let [messages [{:role "system" :content extract-year-sys-prompt}
                  {:role "user" :content text}]
        response (local-chat-completion messages)]
    (-> response
        :choices
        first
        :message
        :content)))

(defn get-doc-by-num [docs-collection doc-num]
  (let [result (ts/search ts-config docs-collection
                         {:q "*"
                          :query_by "doc_num"
                          :include_fields "id,doc_num,title"
                          :filter_by (str "doc_num:=" doc-num)
                          :sort_by "doc_num:asc"
                          :per_page 1})
        hits (get result :hits)]
    (when (seq hits)
      (-> hits first :document))))

(defn get-doc-titles [docs-collection page-size page-num]
  (let [result (ts/search ts-config docs-collection
                         {:q "*"
                          :query_by "doc_num"
                          :include_fields "id,doc_num,title"
                          :sort_by "doc_num:asc"
                          :page page-num
                          :per_page page-size})
        hits (get result :hits)]
    (when (seq hits)
      (mapv :document hits))))

(defn get-chunk-index [chunks-collection doc-num chunk-index]
  (let [result (ts/search ts-config chunks-collection
                         {:q "*"
                          :query_by "doc_num"
                          :include_fields "id,doc_num,chunk_id,content_markdown"
                          :filter_by (str "doc_num:=" doc-num " && chunk_index:=" chunk-index)
                          :sort_by "doc_num:asc"
                          :per_page 1})
        hits (get result :hits)]
    (when (seq hits)
      (-> hits first :document))))

(defn get-year-from-chunks [chunks-collection doc-num]
  (loop [chunk-index 0]
    (when-let [chunk (get-chunk-index chunks-collection doc-num chunk-index)]
      (let [year (extract-relevant-year (:content_markdown chunk))]
        (if (str/starts-with? year "Unknown")
          (recur (inc chunk-index))
          {:doc-num doc-num
           :year year})))))

(defn get-year-from-doc [docs-collection doc-num]
  (when-let [doc (get-doc-by-num docs-collection doc-num)]
    (let [year (extract-relevant-year (:title doc))]
      {:doc-num doc-num
       :year year
       :title (:title doc)})))

(defn compare-years-from-titles-and-chunks
  "Compare years extracted from document titles and chunks, updating the documents where they match.
   Returns a map containing:
   - :processed - number of documents processed
   - :updated - number of documents updated
   - :mismatches - number of documents with mismatched years
   - :errors - number of update errors"
  [docs-collection chunks-collection & {:keys [batch-size stop-on-error start-page]
                                      :or {batch-size 10
                                          stop-on-error false
                                          start-page 1}}]
  (loop [page-num start-page
         processed 0
         updated 0
         mismatches 0
         errors 0]
    (if-let [docs (seq (get-doc-titles docs-collection batch-size page-num))]
      (let [results (for [doc docs
                         :let [doc-num (:doc_num doc)
                               year-from-chunks (get-year-from-chunks chunks-collection doc-num)
                               year-from-doc (get-year-from-doc docs-collection doc-num)]]
                     (try
                       (if (= (:year year-from-chunks) (:year year-from-doc))
                         (do
                           (println "Doc:" doc-num "Year:" (:year year-from-doc))
                           (when-let [response (ts/update-documents! ts-config docs-collection
                                                                 [{:id doc-num
                                                                   :source_published_year (:year year-from-doc)}])]
                             (if (:success (first response))
                               {:status :updated}
                               {:status :error
                                :error (get-in response [0 :error])}))
                           {:status :updated})
                         (do
                           (println "Doc:" doc-num 
                                  "Year from title:" (:year year-from-doc)
                                  "Year from chunks:" (:year year-from-chunks)
                                  "- title and chunks do not match")
                           {:status :mismatch}))
                       (catch Exception e
                         {:status :error
                          :error (.getMessage e)})))
             new-errors (count (filter #(= :error (:status %)) results))
             new-updated (count (filter #(= :updated (:status %)) results))
             new-mismatches (count (filter #(= :mismatch (:status %)) results))]
        
        (when (and stop-on-error (pos? new-errors))
          (println "\nStopping due to errors on page " page-num)
          (throw (ex-info "Document update failed" 
                         {:processed (+ processed (count docs))
                          :updated (+ updated new-updated)
                          :mismatches (+ mismatches new-mismatches)
                          :errors (+ errors new-errors)})))
        
        (when (zero? (mod page-num 4))
          (println (format "\nProgress: page %d | processed %d | updated %d | mismatches %d | errors %d"
                         page-num
                         (+ processed (count docs))
                         (+ updated new-updated)
                         (+ mismatches new-mismatches)
                         (+ errors new-errors))))
        
        (recur (inc page-num)
               (+ processed (count docs))
               (+ updated new-updated)
               (+ mismatches new-mismatches)
               (+ errors new-errors)))
      
      ; Return final summary
      {:processed processed
       :updated updated
       :mismatches mismatches
       :errors errors})))

(comment
  (def docs-collection "TEST_kudos_docs")
  (def chunks-collection "TEST_kudos_chunks")
  
  ;; Process all documents and compare years from titles and chunks
  (compare-years-from-titles-and-chunks
   docs-collection chunks-collection :start-page 3 :stop-on-error true)

  (get-doc-titles docs-collection 10 2)

  (extract-relevant-year "Årsrapport Fiskeridirektoratet 2023")
  (get-chunk-index chunks-collection "12098" 0)

  (get-year-from-doc docs-collection "1261")
  (get-year-from-doc docs-collection "12098")
  (get-year-from-doc docs-collection "13525")
  (get-year-from-doc docs-collection "84139")
  (get-year-from-doc docs-collection "12098")

  (def doc-num "30901") ;; should be 2022
  (get-year-from-doc docs-collection doc-num)
  (get-year-from-chunks chunks-collection doc-num)
  (get-doc-by-num docs-collection doc-num)
  (get-chunk-index chunks-collection doc-num 1)

  (def doc-num "414") ;; should be 2021
  (get-year-from-doc docs-collection doc-num)
  (get-year-from-chunks chunks-collection doc-num)
  (get-doc-by-num docs-collection doc-num)
  (get-chunk-index chunks-collection doc-num 0)

  (def doc-num "449") ;; should be 2021
  (get-doc-by-num docs-collection doc-num)
  (get-year-from-doc docs-collection doc-num)
  (get-year-from-chunks chunks-collection doc-num)
  (get-chunk-index chunks-collection doc-num 0)


  (def doc-num "31944") 
  (get-doc-by-num docs-collection doc-num)
  (get-year-from-doc docs-collection doc-num) ;; should be Unknown
  (get-year-from-chunks chunks-collection doc-num) ;; should be 2023 from chunk 1
  (get-chunk-index chunks-collection doc-num 1)
  
  )