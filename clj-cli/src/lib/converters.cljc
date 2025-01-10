(ns lib.converters)

(defn bytes-to-hex [bytes]
  (let [hex-chars "0123456789abcdef"]
    (apply str
           (for [b bytes]
             (let [v (bit-and b 0xFF)]
               (str (get hex-chars (bit-shift-right v 4))
                    (get hex-chars (bit-and v 0x0F))))))))

#?(:clj
   (defn sha1
     "Calculate SHA1 hash of input string"
     [s]
     (let [md (java.security.MessageDigest/getInstance "SHA-1")
           bytes (.getBytes s "UTF-8")]
       (-> md
           (.digest bytes)
           bytes-to-hex))))

#?(:clj (defn env-var [key]
          (System/getenv key)))