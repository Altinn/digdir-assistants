(ns typesense.files-metadata
  (:require [typesense.api-config :refer [typesense-config]]
            [cheshire.core :as json]
            [clj-http.client :as http]
            [typesense.search :refer [multi-search]]))

(defn upsert-file-chunkr-status [files-collection-name file-id new-status]
  (let [url (str (get-in typesense-config [:nodes 0 :protocol]) "://"
                 (get-in typesense-config [:nodes 0 :host]) "/collections/"
                 files-collection-name "/documents/" file-id)
        body {:chunkr_status new-status}]
    (try
      (let [response (http/patch url
                                 {:headers {"X-TYPESENSE-API-KEY" (:api-key typesense-config)
                                            "Content-Type" "application/json"}
                                  :body (json/generate-string body)})]
        (if (= 200 (:status response))
          ::ok
          #_(println "Successfully updated chunkr_status for file-id:" file-id)
          (println "Failed to update chunkr_status. Status:" (:status response))))
      (catch Exception e
        (println "Error updating chunkr_status:" (.getMessage e))))))


(defn get-file-metadata [files-collection-name doc-num]
  (let [result (multi-search
                {:collection files-collection-name
                 :q doc-num
                 :query-by "doc_num"
                 :filter-by (str "doc_num:=" doc-num)
                 :include-fields "*"
                 :page 1
                 :per_page 1})]
    (if (:success result)
      (-> result :hits first)
      (println "Failed to retrieve file metadata for doc_num:" doc-num ". Error:" (:message result)))))


(comment
  
  (get-file-metadata "KUDOS_files_2024-09-27_chunkr_bb" "90487")
  
  )