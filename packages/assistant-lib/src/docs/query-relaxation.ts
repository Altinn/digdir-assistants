import Instructor from "@instructor-ai/instructor";
import { z } from "zod";
import {
  // azure_client,
  openaiClient,
} from "../llm";
import { scopedEnvVar } from "../general";

const stage_name = "DOCS_QA_EXTRACT";
const envVar = scopedEnvVar(stage_name);

// const azureClient = azure_client();
const openaiClientInstance = Instructor({
  client: openaiClient() as any,
  mode: "FUNCTIONS",
  debug: envVar("DEBUG_INSTRUCTOR"),
});

const QueryRelaxationSchema = z.object({
  searchQueries: z.array(z.string()),
});

export type QueryRelaxation = z.infer<typeof QueryRelaxationSchema> | null;

export async function queryRelaxation(
  user_input: string,
  channelQueryRelaxPrompt: string = "",
): Promise<QueryRelaxation> {
  let query_result: QueryRelaxation | null = null;

  const prompt = `You have access to a search API that returns relevant documentation.

    Your task is to generate an array of up to 7 search queries that are relevant to this question. 
    Use a variation of related keywords and synonyms for the queries, trying to be as general as possible.
    Include as many queries as you can think of, including and excluding terms.
    For example, include queries like ['keyword_1 keyword_2', 'keyword_1', 'keyword_2'].
    Be creative. The more queries you include, the more likely you are to find relevant results.
    
    ${channelQueryRelaxPrompt}`;

  if (envVar("USE_AZURE_OPENAI_API", false) == "true") {
    //         query_result = await azureClient.chat.completions.create({
    //             model: envVar('AZURE_OPENAI_DEPLOYMENT'),
    //             response_model: { schema: SearchQueriesSchema, name: "GeneratedSearchQueries" },
    //             temperature: 0.1,
    //             max_retries: 0,
    //             messages: [
    //                 {
    //                     role: "system",
    //                     content: prompt },
    //                 { role: "user", content: "[User query]\n" + user_input },
    //             ]
    //         });
  } else {
    console.log(
      `${stage_name} model name: ${envVar("OPENAI_API_MODEL_NAME", "")}`,
    );
    if (envVar("LOG_LEVEL") == "debug") {
      console.log(`query relax prompt: \n${prompt}`);
    }
    query_result = await openaiClientInstance.chat.completions.create({
      model: envVar("OPENAI_API_MODEL_NAME"),
      response_model: {
        schema: QueryRelaxationSchema,
        name: "QueryRelaxation",
      },
      temperature: 0.1,
      max_retries: 0,
      messages: [
        {
          role: "system",
          content: prompt,
        },
        { role: "user", content: "[User query]\n" + user_input },
      ],
    });
  }

  if (!query_result) {
    return null;
  }

  for (let i = 0; i < query_result.searchQueries.length; i++) {
    query_result.searchQueries[i] = query_result.searchQueries[i]
      .replace("GitHub", "")
      .trim();
  }

  return query_result;
}
