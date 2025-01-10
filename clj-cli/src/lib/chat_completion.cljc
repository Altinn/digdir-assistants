(ns lib.chat-completion
  (:require #?(:clj [wkok.openai-clojure.api :as api])))


#?(:clj
   (defn create-chat-completion [messages]
     (if (= "true" (System/getenv "USE_AZURE_OPENAI"))
       (api/create-chat-completion
        {:model (System/getenv "AZURE_OPENAI_DEPLOYMENT_NAME")
         :messages messages
         :temperature 0.1
         :max_tokens nil}
        {:api-key (System/getenv "AZURE_OPENAI_API_KEY")
         :api-endpoint (System/getenv "AZURE_OPENAI_ENDPOINT")
         :impl :azure})
       (api/create-chat-completion
        {:model (System/getenv "OPENAI_API_MODEL_NAME")
         :messages messages
         :temperature 0.1
         :stream false
         :max_tokens nil}))))