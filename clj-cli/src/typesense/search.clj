(ns typesense.search
  (:require [typesense.api-config :refer [typesense-config typesense-api-url]]
            [clj-http.client :as http]
            [cheshire.core :as json]
            [clojure.string :as str]))

(defn handle-response [status body]
  (case status
    200 {:success true :body body}
    400 {:success false :error :invalid-parameters :message (get body "message")}
    401 {:success false :error :authentication-error :message "Invalid API key"}
    404 {:success false :error :not-found :message (get body "message")}
    429 {:success false :error :rate-limit-exceeded :message "Too many requests"}
    500 {:success false :error :server-error :message "Typesense server error"}
    503 {:success false :error :service-unavailable :message "Service temporarily unavailable"}
    {:success false :error :unknown-error :message (str "Unknown error: " (get body "message"))}))

(defn validate-search-params [{:keys [collection query-by]}]
  (if (and collection query-by)
    {:success true}
    {:success false
     :error :invalid-parameters
     :message "collection and query-by are required parameters"}))


(defn validate-multi-search-params [{:keys [collection query-by]}]
  (if (and collection query-by)
    {:success true}
    {:success false
     :error :invalid-parameters
     :message "collection and query-by are required parameters"}))

(defn validate-multi-filter-params [{:keys [collection filter-by]}]
  (if (and collection filter-by)
    {:success true}
    {:success false
     :error :invalid-parameters
     :message "collection and filter-by are required parameters"}))


(defn multi-search [{:keys [collection query-by q include-fields filter-by facet-by sort-by page page-size] :as params}]
  (let [validation-result (validate-multi-search-params params)]
    (if-not (:success validation-result)
      validation-result
      (let [searches (if (sequential? q)
                      ;; If q is a sequence, create a search object for each query
                       (mapv (fn [query]
                               (merge
                                {:q (or query "*")
                                 :query_by query-by
                                 :collection collection
                                 :include_fields (or include-fields "id")
                                 :per_page (or page-size 10)
                                 :page (or page 1)}
                                (when facet-by
                                  {:facet_by facet-by})
                                (when filter-by
                                  {:filter_by filter-by})
                                (when sort-by
                                  {:sort_by sort-by})))
                             q)
                      ;; Otherwise create a single search object
                       [(merge
                         {:q (or q "*")
                          :query_by query-by
                          :collection collection
                          :include_fields (or include-fields "id")
                          :per_page (or page-size 10)
                          :page (or page 1)}
                         (when facet-by
                           {:facet_by facet-by})
                         (when filter-by
                           {:filter_by filter-by})
                         (when sort-by
                           {:sort_by sort-by}))])]
        (try
          (let [search-body (json/generate-string {:searches searches})
                ;; _ (prn :search-body search-body)
                response (http/post (typesense-api-url :multi-search collection)
                                    {:headers {"X-TYPESENSE-API-KEY" (:api-key typesense-config)}
                                     :body search-body 
                                     :content-type :json
                                     :as :json
                                     :throw-exceptions false})
                ;; _ (prn response)
                ]
            (if (= (:status response) 200)
              {:success true
               :hits (->> (get-in response [:body :results])
                          (mapcat :hits)
                          (map :document))}
              (handle-response (:status response)
                               (json/parse-string (:body response)))))
          (catch java.net.ConnectException _
            {:success false
             :error :connection-error
             :message "Could not connect to Typesense server"})
          (catch Exception e
            {:success false
             :error :unknown-error
             :message (.getMessage e)}))))))

(defn multi-filter [{:keys [collection q include-fields filter-by page page-size] :as params}]
  (let [validation-result (validate-multi-filter-params params)]
    (if-not (:success validation-result)
      validation-result
      (let [base-url (typesense-api-url :multi-search collection)
            searches (if (sequential? q)
                      ;; If q is a sequence, create a search object for each query
                       (mapv (fn [query]
                               (merge
                                {:q "*"
                                 :collection collection
                                 :include_fields (or include-fields "id")}
                                (when filter-by
                                  {:filter_by (str filter-by ":= `" query "`")})
                                (when page-size
                                  {:per_page page-size})
                                (when page
                                  {:page page})))
                             q)
                      ;; Otherwise create a single search object
                       [(merge
                         {:q "*"
                          :collection collection
                          :include_fields (or include-fields "id")}
                         (when filter-by
                           {:filter_by (str filter-by ":= `" q "`")})
                         (when page-size
                           {:per_page page-size})
                         (when page
                           {:page page}))])]
        (try
          (let [search-body (json/generate-string {:searches searches})
                ;; _ (prn :search-body search-body)
                response (http/post base-url
                                    {:headers {"X-TYPESENSE-API-KEY" (:api-key typesense-config)}
                                     :body search-body 
                                     :content-type :json
                                     :as :json
                                     :throw-exceptions false})
                ;; _ (prn response)
                ]
            (if (= (:status response) 200)
              {:success true
               :hits (->> (get-in response [:body :results])
                          (mapcat :hits)
                          (map :document))}
              (handle-response (:status response)
                               (json/parse-string (:body response)))))
          (catch java.net.ConnectException _
            {:success false
             :error :connection-error
             :message "Could not connect to Typesense server"})
          (catch Exception e
            {:success false
             :error :unknown-error
             :message (.getMessage e)}))))))

(comment
  
  (def chunks-result
    (multi-search {:collection "KUDOS_chunks_2024-09-27_chunkr_test"
                   :q "*"
                   :query-by "doc_num"
                   :include-fields "doc_num"
                   :facet-by "doc_num"
                   :page-size 30
                   :page 1}))

;; Example 1: Basic search
  (search {:collection "KUDOS_docs_2024-09-27_chunkr_test"
           :query-by "publisher_short"
           :include-fields "doc_num,publisher_short"
          ;;  :page-size 15
           :q "KDD"})

  (multi-search {:collection "KUDOS_docs_2024-09-27_chunkr_test"
                 :query-by "publisher_short"
                 :include-fields "doc_num,publisher_short"
                 :page-size 15
                 :q [ "KDD" "DFD"]})
  
  (multi-filter {:collection "KUDOS_docs_2024-09-27_chunkr_test"
                 :filter-by "publisher_short"
                 :include-fields "doc_num,publisher_short"
                 :page-size 3
                 :q ["KUD" "KDD" ]})

;; Example 2: Search with filtering and pagination
  (multi-search {:collection "KUDOS_docs_2024-09-27_chunkr_test"
                 :query-by "publisher_short"
                 :include-fields "doc_num,publisher_short"
                 :q "KUD" 
                 :page 1
                 :page-size 20})


;; Example 3: Search with specific fields to include
  (multi-search {:collection "users"
                 :query-by "name,email"
                 :q "john"
                 :include-fields "name,email,role"})

;; Example 4: Wildcard search with error handling
  (let [result (multi-search {:collection "documents"
                              :query-by "content"
                              :q "*"})]
    (if (:success result)
      (println "Found" (count (:hits result)) "documents")
      (println "Error:" (:message result)))))