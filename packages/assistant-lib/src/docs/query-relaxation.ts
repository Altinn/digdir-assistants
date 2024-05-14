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
  promptRagQueryRelax: string = "",
): Promise<QueryRelaxation> {
  let query_result: QueryRelaxation | null = null;

  const prompt = promptRagQueryRelax;

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
      console.log(`prompt.rag.queryRelax: \n${prompt}`);
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
