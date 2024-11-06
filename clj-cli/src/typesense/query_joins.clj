(ns typesense.query-joins
  (:require [typesense.api-config :refer [typesense-config]]
            [clj-http.client :as http]
            [cheshire.core :as json]))

(defn query-kudos-chunks-with-join []
  (let [base-url (str "https://" (get-in typesense-config [:nodes 0 :host]) "/multi_search")
        searches [{
                   :q "*"
                   :collection "DEV_kudos-chunks"
                  ;;  :query_by "content_markdown"
                   :include_fields "doc_num,$DEV_kudos-docs(title,type, strategy: merge)" 
                  ;;  :filter_by "id: * || DEV_kudos-docs(id: *)"
                   :per_page 3}]
        response (http/post base-url
                            {:headers {"X-TYPESENSE-API-KEY" (:api-key typesense-config)}
                             :body (json/generate-string {:searches searches})
                             :content-type :json
                             :as :json})]
    (-> response
        :body
        (get-in [:results 0 :hits])
        (->> (map (fn [hit]
                    (-> hit
                        (get :document))))))))

(defn print-query-results []
  (let [results (query-kudos-chunks-with-join)]
    (doseq [result results]
      (println "result: " result)
      ;; (println "ID:" (:id result))
      ;; (println "Content:" (:content result))
      ;; (println "Doc Num:" (:doc_num result))
      ;; (println "Type:" (:type result))
      (println "---")
      )))
