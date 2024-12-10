(ns typesense.admin
  (:require
   [cheshire.core :as json]
   [clj-http.client :as http]
   [clojure.string :as str]
   [clojure.tools.logging :as log]
   [typesense.api-config :refer [typesense-api-url typesense-config ts-config]]
   [typesense.client :as ts]
   ))

(defn delete-document-by-id
  "Delete a document from a Typesense collection by its ID.
   Returns a map with :success and either :deleted or :error"
  [collection doc-id]
  (when-not (nil? doc-id)
    (try
      (let [delete-url (str (typesense-api-url :delete collection) "/" doc-id)
            response (http/delete delete-url
                                {:headers {"X-TYPESENSE-API-KEY" (:api-key typesense-config)}
                                 :as :json
                                 :throw-exceptions false})
            _ (prn :response response)
            status (:status response)
            body (if (string? (:body response))
                  (json/parse-string (:body response))
                  (:body response))]
        (if (= status 200)
          {:success true
           :deleted doc-id}
          {:success false
           :error (get body "message" "Unknown error")
           :status status}))
      (catch Exception e
        (log/error "Error deleting document:" (.getMessage e))
        {:success false
         :error (.getMessage e)}))))

(defn update-docs [collection docs]
  (try
    (let [results (ts/update-documents! ts-config collection docs)]
      (if (every? #(= true (:success %)) results)
        (println "Successfully updated all" (count docs) "documents")
        (println "Failed to update some documents. Results:" (pr-str results))))
    (catch Exception e
      (log/error "Error updating doc collection '" collection "': " (.getMessage e)))))

(comment
  ;; Example usages:


  (def docs-to-update [{:id "90757", :orgs_short ["DFD" "Digdir"]}
                       {:id "90715", :orgs_short ["DFD" "Digdir"]}])
  
  (ts/update-documents! ts-config "KUDOS_docs_2024-12-10" docs-to-update)
  (update-docs "KUDOS_docs_2024-12-10" docs-to-update)


  (def id-list ["90840" "90486"])
  (str "doc_num: ['" (str/join "','" id-list) "']")
  (delete-document-by-id "KUDOS_docs_2024-09-27_chunkr_bb" "90840")
  
(def ids-to-import #{"30965"
                     "2649"
                     "33169"
                     "16133"
                     "22084"
                     "8322"
                     "17306"
                     "29980"
                     "26024"
                     "30832"
                     "26803"
                     "32613"
                     "90487"
                     "302"
                     "30010"
                     "32351"
                     "16940"
                     "90715"
                     "16801"
                     "32643"
                     "7024"
                     "2216"
                     "5221"
                     "30977"
                     "5454"
                     "30776"
                     "24488"
                     "27207"
                     "31119"
                     "31994"
                     "32001"
                     "4240"
                     "30009"
                     "30975"
                     "14660"
                     "24753"
                     "32421"
                     "30963"
                     "22742"
                     "30967"
                     "32418"
                     "22302"
                     "24901"
                     "2421"
                     "2329"
                     "32062"
                     "90757"})
  
  (str "(id IN (" (str/join "," ids-to-import)  ")")

  )