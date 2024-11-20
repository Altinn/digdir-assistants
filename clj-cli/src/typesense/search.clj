(ns typesense.search
  (:require [typesense.api-config :refer [typesense-config]]
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

(defn multi-search [{:keys [collection query-by q include-fields filter-by page page-size] :as params}]
  (let [validation-result (validate-search-params params)]
    (if-not (:success validation-result)
      validation-result
      (let [base-url (str (get-in typesense-config [:nodes 0 :protocol])
                          "://"
                          (get-in typesense-config [:nodes 0 :host])
                          "/multi_search")
            searches [{:q (or q "*")
                       :query_by query-by
                       :collection collection
                       :include_fields (or include-fields "id")

                       ;; TODO: filter_by needs to be assoc'ed in
                      ;;  :filter_by filter-by
                      ;;  :per_page page-size
                      ;;  :page page ;; not supported
                       }]]
        (try
          (let [response (http/post base-url
                                  {:headers {"X-TYPESENSE-API-KEY" (:api-key typesense-config)}
                                   :body (json/generate-string {:searches searches
                                                             })
                                   :content-type :json
                                   :as :json
                                   :throw-exceptions false})]
            (if (= (:status response) 200)
              {:success true
               :hits (-> response
                        :body
                        (get-in [:results 0 :hits])
                        (->> (map :document)))}
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
  
;; Example 1: Basic search
(multi-search {:collection "KUDOS_docs_2024-09-27_chunkr_test"
               :query-by "publisher_short"
               :include-fields "doc_num,publisher_short"
               :q "KDD"})

;; Example 2: Search with filtering and pagination
(multi-search {:collection "products"
               :query-by "name,description"
               :q "laptop"
               :filter-by "price:< 1000 && in_stock:true"
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
    (println "Error:" (:message result))))
  
  )