import { ConfigurationOptions } from 'typesense/lib/Typesense/Configuration.js';

type ConfigData = {
  TYPESENSE_CONFIG: ConfigurationOptions;
  TYPESENSE_DOCS_COLLECTION: string;
  TYPESENSE_DOCS_SEARCH_PHRASE_COLLECTION: string;
};

export function config(): ConfigData {
  let configData = {
    TYPESENSE_CONFIG: {
      nodes: [
        {
          host: process.env.TYPESENSE_API_HOST || '',
          port: 443,
          protocol: 'https',
        },
      ],
      apiKey: process.env.TYPESENSE_API_KEY || '',
      connection_timeout_seconds: 2,
    },
    TYPESENSE_DOCS_COLLECTION: process.env.TYPESENSE_DOCS_COLLECTION || '',
    TYPESENSE_DOCS_SEARCH_PHRASE_COLLECTION:
      process.env.TYPESENSE_DOCS_SEARCH_PHRASE_COLLECTION || '',
  };

  return configData;
}
