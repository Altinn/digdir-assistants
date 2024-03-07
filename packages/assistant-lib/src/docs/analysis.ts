import Instructor from "@instructor-ai/instructor";
import { z } from "zod";

import { openaiClient } from "../llm";
import { scopedEnvVar } from "../general";
import { stage1_analyze_query } from "./prompts";

const stageName: string = "DOCS_QA_ANALYZE";
const envVar = scopedEnvVar(stageName);

// const azureClientInstance = azure_client();
const openaiClientInstance = Instructor({
  client: openaiClient() as any,
  mode: "FUNCTIONS",
  debug: envVar("DEBUG_INSTRUCTOR"),
});

const UserQueryAnalysisSchema = z.object({
  userInputLanguageCode: z
    .string()
    .describe("ISO 639-1 language code for the user query"),
  userInputLanguageName: z
    .string()
    .describe("ISO 639-1 language name for the user query"),
  questionTranslatedToEnglish: z
    .string()
    .describe("The user's question, translated to English"),
  contentCategory: z
    .enum([
      "Support Request",
      "For Your Information",
      "Pull request announcement",
      "None of the above",
    ])
    .describe("One of the following categories"),
});

export type UserQueryAnalysis = z.infer<typeof UserQueryAnalysisSchema> | null;

export async function userInputAnalysis(
  userInput: string
): Promise<UserQueryAnalysis> {
  let queryResult: UserQueryAnalysis | null = null;

  if (envVar("USE_AZURE_OPENAI_API", false) === "true") {
    // queryResult = await azureClientInstance.chat.completions.create({
    //     model: envVar('AZURE_OPENAI_DEPLOYMENT'),
    //     response_model: { schema: UserQueryAnalysisSchema, name: "UserQueryAnalysis" },
    //     temperature: 0.1,
    //     messages: [
    //         { role: "system", content: stage1_analyze_query },
    //         { role: "user", content: userInput },
    //     ],
    // });
  } else {
    queryResult = await openaiClientInstance.chat.completions.create({
      model: envVar("OPENAI_API_MODEL_NAME", ""),
      response_model: {
        schema: UserQueryAnalysisSchema,
        name: "UserQueryAnalysis",
      },
      temperature: 0.1,
      messages: [
        { role: "system", content: stage1_analyze_query },
        { role: "user", content: `[USER INPUT]\n${userInput}` },
      ],
    });
  }

  return queryResult;
}
