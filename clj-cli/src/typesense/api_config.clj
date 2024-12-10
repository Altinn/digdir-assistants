(ns typesense.api-config)

(def typesense-config
  {:nodes [{:host (System/getenv "TYPESENSE_API_HOST")
            :port 443
            :protocol "https"}]
   :api-key (System/getenv "TYPESENSE_API_KEY_ADMIN")})

(def ts-config
  {:uri (str (get-in typesense-config [:nodes 0 :protocol]) "://"
             (get-in typesense-config [:nodes 0 :host]))
   :key (get-in typesense-config [:api-key])})

(defn typesense-api-url [api collection]
  (str (get-in typesense-config [:nodes 0 :protocol])
       "://"
       (get-in typesense-config [:nodes 0 :host])
       "/"
       (case api
         :multi-search "multi_search"
         :search (str "collections/" collection "/documents/search")
         :update-multiple (str "collections/" collection "/documents/import?action=update")
         :delete (str "collections/" collection "/documents") 
         "")))

