(ns kudos-chunks.update-search-phrases
  (:require [clojure.string :as str]
            [malli.core :as m]
            [malli.util :as mu]
            [typesense.search :refer [multi-search]]
            [typesense.import-collection :refer [upsert-collection]]
            [typesense.api-config :refer [typesense-config ts-config]]
            [typesense.client :as ts]
            [taoensso.timbre :as log]
            [cheshire.core :as json]
            [clj-http.client :as http]
            [lib.chat-completion :as llm]
            [lib.converters :refer [env-var]]
            [wkok.openai-clojure.api :as openai]
            [clojure.java.io :as io])
  (:import [java.util.concurrent Executors TimeUnit]
           [java.time Instant Duration]))

;; Schema definitions
(def SearchPhrase
  [:map
   [:search-phrase string?]])

(def SearchPhraseList
  [:map
   [:search-phrases [:vector SearchPhrase]]])

(def SearchHit
  [:map
   [:id string?]
   [:doc-num string?]
   [:url string?]
   [:content-markdown string?]])

(def search-results-tools
  [{:type "function"
    :function
    {:name "searchPhrases"
     :parameters
     {:type "object"
      :properties
      {:searchPhrases
       {:type "array"
        :items {:type "string"}}}}}}])

;; Constants and configuration
(def prompts
  {:original 
   (str "Please analyze the contents of the following documentation article and generate a list of English phrases that you would expect to match the following document.\n\nDocument:\n\n")
   :keyword-search 
   (str "Please analyze the contents of the following documentation article "
        "and generate a list of keyword search phrases that have high information retrieval value. " 
        "If the text is not comprehensible, just return an empty list.\n\nDocument:\n\n")
   :typicalqs "Generate a list of typical questions that a user might have, that can be answered by the following documentation article. Return only the list of questions as a JSON string array in a code block, do not include answers."})

(defn retrieve-all-chunks [source-collection page page-size]
  ;; (log/debug "Retrieving chunks from collection:" source-collection "page:" page "size:" page-size)
  (let [search-response (multi-search
                         {:collection source-collection
                          :query-by "chunk_id"
                          :q "*"
                          :include-fields "chunk_id,doc_num,chunk_index,content_markdown,markdown_checksum" 
                          :sort-by "chunk_index:asc"
                          :page page
                          :page-size page-size})]
    (if (:success search-response)
      (let [;;_ (log/debug "Chunk retrieval response:" search-response)
            results (get-in search-response [:hits])]
        (log/debug "Retrieved" (count results) "chunks")
        results)
      (do
        (log/error "Failed to retrieve chunks:" search-response)
        nil))))

(defn with-retries
  [f max-retries]
  (loop [retry-count 0]
    (if (>= retry-count max-retries)
      (throw (Exception. "Max retries exceeded"))
      (let [result (try
                     {:success true :value (f)}
                     (catch Exception e
                       {:success false :error e}))]
        (if (:success result)
          (:value result)
          (do
            (log/error "Error occurred, retrying..." (ex-message (:error result)))
            (Thread/sleep 5000)
            (recur (inc retry-count))))))))

(defn generate-search-phrases [prompt-name chunk]
  (log/debug "Generating search phrases for chunk-id:" (:chunk_id chunk) 
             "with prompt:" prompt-name)
  (let [base-prompt (get prompts (keyword prompt-name))
        content (:content_markdown chunk)
        use-azure-openai (= "true" (env-var "USE_AZURE_OPENAI_API"))]
    (if (or (= "original" prompt-name) (= "keyword-search" prompt-name))
      (with-retries
        (fn []
          (let [response
                (if use-azure-openai
                  (openai/create-chat-completion
                   {:model "gpt-4o"
                    :deployment-id (env-var "AZURE_OPENAI_DEPLOYMENT_NAME")
                    :messages [{:role "system" :content "You are a helpful assistant. Reply with supplied JSON format."}
                               {:role "user" :content (str base-prompt content)}]
                    :tools search-results-tools
                    :tool_choice {:type "function"
                                  :function {:name "searchPhrases"}}
                    :temperature 0.1
                    :max_tokens nil}
                   {:api-key (env-var "AZURE_OPENAI_API_KEY")
                    :api-endpoint (env-var "AZURE_OPENAI_ENDPOINT")
                    :impl :azure})
                  (openai/create-chat-completion
                   {:model (env-var "OPENAI_API_MODEL_NAME")
                    :messages [{:role "system" :content "You are a helpful assistant. Reply with supplied JSON format."}
                               {:role "user" :content (str base-prompt content)}]
                    :tools search-results-tools
                    :tool_choice {:type "function"
                                  :function {:name "searchPhrases"}}
                    :temperature 0.1
                    :max_tokens nil}
                   {}))
                ;; _ (log/debug "LLM response:" response)
                choices (get response :choices)
                tool-call (-> choices 
                            first 
                            (get-in [:message :tool_calls])
                            first)
                search-phrases (when tool-call
                               (-> tool-call
                                   (get-in [:function :arguments])
                                   json/parse-string
                                   (get "searchPhrases")))
                ;; _ (log/debug "Generated search phrases:")
                ;; _ (doseq [phrase search-phrases]
                ;;     (log/debug "  -" phrase))
                phrases {:search-phrases 
                        (mapv (fn [phrase] {:search-phrase phrase})
                              (or search-phrases []))}] 
            phrases))
        10)
      (throw (ex-info (str "Unknown prompt name: " prompt-name)
                      {:prompt prompt-name})))))

(defn get-existing-phrases [target-collection chunk-id]
  ;; (log/debug "Retrieving existing phrases for chunk-id:" chunk-id)
  (let [result (multi-search
                {:collection target-collection
                 :q chunk-id
                 :query-by "chunk_id"
                 :filter-by (str "chunk_id:=" chunk-id)
                 :include-fields "*"
                 :page 1
                 :per_page 100})]
    (when (:success result)
      (:hits result))))

(defn delete-existing-phrases [target-collection chunk-id existing-phrase-ids] 
  (let [ids (mapv :id existing-phrase-ids)]
    (when (seq ids)
      (log/debug "Deleting existing phrases for chunk_id:" chunk-id)
      (ts/delete-documents! ts-config target-collection ids))))

(defn store-search-phrases [target-collection chunk phrases prompt-name]
  (let [timestamp (quot (System/currentTimeMillis) 1000)
        phrases (map-indexed 
              (fn [phrase-index phrase]
                (let [chunk-id (:chunk_id chunk)
                      chunk-index (:chunk_index chunk)]
                  {:id (str chunk-id "-" phrase-index)
                   :chunk_id chunk-id
                   :doc_num (:doc_num chunk)
                   :search_phrase (:search-phrase phrase)
                   :sort_order chunk-index
                   :language "no"
                   :type "content"
                   :updated_at timestamp
                   :prompt prompt-name
                   :item_priority 1
                   :checksum (:markdown_checksum chunk)}))
              (:search-phrases phrases))
        temp-file (str "./typesense_batch_" (:chunk_id chunk) "_" timestamp ".jsonl")] 
    (log/debug "Uploading" (count phrases) "search phrases for chunk_id:" (:chunk_id chunk))
    
    ;; Write documents to temp file
    (with-open [w (io/writer temp-file)]
      (doseq [phrase phrases]
        (.write w (str (json/generate-string phrase) "\n"))))
    
    ;; Import the batch
    (try
      (upsert-collection target-collection temp-file 100 nil)
      (finally
        ;; Clean up temp file
        (io/delete-file temp-file true)))))

(defn process-chunk [target prompt-name chunk stats-atom]
  ;; (log/debug "Processing chunk:" chunk)
  (let [start-time (Instant/now)]
    (try
      (let [existing (get-existing-phrases target (:chunk_id chunk))
            existing-checksum (some-> existing first :checksum)
            current-checksum (:markdown_checksum chunk)]
        (when (or (nil? existing-checksum)
                  (not= existing-checksum current-checksum))
          (when existing
            (delete-existing-phrases target (:chunk_id chunk) existing))
          (let [phrases (generate-search-phrases prompt-name chunk)]
            (if (= 0 (count (:search-phrases phrases)))
              (swap! stats-atom update :empties inc) 
              (store-search-phrases target chunk phrases prompt-name))))
        (swap! stats-atom update :successes inc))
      (catch Exception e
        (swap! stats-atom update :failures inc)
        (log/error "Failed to process chunk:" chunk "error:" (ex-message e)))
      (finally
        (let [duration (.toMillis (Duration/between start-time (Instant/now)))]
          (swap! stats-atom (fn [stats]
                             (-> stats
                                 (update :total-time + duration)
                                 (update :chunks-processed inc)))))))))

(defn process-chunk-group [target prompt-name chunk-group stats-atom]
  (doseq [chunk chunk-group]
    (process-chunk target prompt-name chunk stats-atom)))

(defn print-stats [stats page]
  (let [{:keys [total-time chunks-processed successes failures empties]} stats
        avg-time (if (pos? chunks-processed)
                  (double (/ total-time chunks-processed))
                  0)]
    (log/info "=== Page" page "Statistics ===")
    (log/info "Total chunks processed:" chunks-processed)
    (log/info "Successful updates:" successes)
    (log/info "Non-comprehensible chunks:" empties)
    (log/info "Failed updates:" failures)
    (log/info "Total processing time:" (format "%.2f sec" (/ total-time 1000.0)))
    (log/info "Average time per chunk:" (format "%.2f ms" avg-time))
    (log/info "=========================")))

(defn create-thread-pool [thread-count]
  (let [num-threads (min 10 (max 1 thread-count))]
    (log/info "Creating thread pool with" num-threads "threads")
    (Executors/newFixedThreadPool num-threads)))

(defn chunk-index-modulo [chunk thread-count]
  (mod (:chunk_index chunk) thread-count))

(defn doc-num-modulo [chunk thread-count]
  (mod (Integer/parseInt (:doc_num chunk)) thread-count))


(defn distribute-work [chunks thread-count]
  (let [groups (->> chunks
                    (group-by #(doc-num-modulo % thread-count))
                    vals)]
    (log/debug "Chunk distribution:"
              (map #(map :chunk_index %) groups))
    groups))

(defn -main [& args]
  (let [[source target & opts] args
        opts-map (into {} (for [opt opts
                               :when (str/starts-with? opt "--")]
                           [opt (if (= opt "--create-new")
                                 true
                                 (get (vec opts) (inc (.indexOf opts opt))))]))
        prompt-name (get opts-map "--prompt" "keyword-search")
        thread-count (if-let [threads (get opts-map "--threads")]
                      (Integer/parseInt threads)
                      1)
        page-size (* 10 thread-count)  ; Increased page size to account for threads
        start-page (if-let [start (get opts-map "--start")]
                    (Integer/parseInt start)
                    1)
        thread-pool (create-thread-pool thread-count)]
    (try
      (log/debug "Starting with options:" 
                {:source source 
                 :target target 
                 :threads thread-count 
                 :page-size page-size
                 :opts opts-map})
      (log/info "Processing collection:" target)
      
      (loop [page start-page]
        (log/debug "Processing page:" page)
        (when-let [chunks (retrieve-all-chunks source page page-size)]
          (let [stats-atom (atom {:total-time 0
                                  :chunks-processed 0
                                  :successes 0
                                  :failures 0
                                  :empties 0})
                work-groups (distribute-work chunks thread-count)
                _ (log/debug "Work groups:" (count work-groups))

                page-start-time (Instant/now)
                futures (doall  ; Force immediate execution
                         (map #(.submit thread-pool
                                      ^Callable (fn []
                                                (process-chunk-group target prompt-name % stats-atom)))
                              work-groups))]
            ; Wait for all futures to complete before moving to next page
            (doseq [f futures]
              (.get f))
            
            (let [page-duration (.toMillis (Duration/between page-start-time (Instant/now)))]
              (swap! stats-atom assoc :page-time page-duration)
              (print-stats @stats-atom page)))
          
          (when (seq chunks)
            (recur (inc page)))))
      
      (finally
        (.shutdown thread-pool)
        (.awaitTermination thread-pool 1 TimeUnit/HOURS)))))