import Groq from 'groq-sdk';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { envVar } from '@digdir/assistant-lib';
import Instructor from '@instructor-ai/instructor';
import { Command } from 'commander';

import { openaiClient, extractCodeBlockContents } from '@digdir/assistant-lib';
import { z } from 'zod';

const RetrievalEvalSchema = z.object({
  insufficientInformationProvided: z.boolean(),
});

type RetrievalEval = z.infer<typeof RetrievalEvalSchema>;

const systemPrompt = "You are a helpful assistant.";

let prompt = "You are an AI assistant tasked with analyzing responses to user queries." + 
"Your goal is to identify answers that indicate the AI doesn't have enough information to provide a specific or definitive response. These answers often include phrases like 'I don't have information on...', 'The provided information does not include...', or suggestions to check official documentation or contact support teams." + 
"Given a response, determine if it falls into this category of 'insufficient information' answers. If it does, explain why you think so. If it doesn't, explain why it appears to be a more definitive or informative answer." + 
"Here are two example responses that indicate insufficient information:\n" + 
"\"I don't have information on the exact release date of Altinn 3. If you need specific details about the release date, you might want to check the official Altinn documentation or contact their support team.\"" +
"\"The provided information does not include details about accepting payments in an app. For more information, you may need to consult additional documentation or contact Altinn Studio support directly.\"\n" +
"Now, analyze the following response and determine if it indicates insufficient information or if it provides a more definitive answer.\"";

const chatResponseIntro = "Your task is to determine whether sufficient information was provided for the chat bot to be able to formulate a useful response.\n";

   
const openAI = openaiClient();
const openaiClientInstance = Instructor({
  client: openAI as any,
  mode: 'FUNCTIONS',
  debug: true,
});

async function evalRetrievalSuccess(chatResponse: string): Promise<RetrievalEval> {

  let retryCount = 0;

  console.log('Evaluating following response:\n', chatResponse);

  while (true) {
    try {
      let queryResult = await openaiClientInstance.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.1,
        response_model: {
          schema: RetrievalEvalSchema,
          name: 'RetrievalEvalSchema',
        },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt + chatResponse },
        ],
      });

      console.log(`RESULT:\n${JSON.stringify(queryResult)}`);

      return '';

      if (queryResult && queryResult.choices && queryResult.choices.length > 0) {
        // use

        const response = queryResult?.choices[0]?.message?.content || '';
        console.log(`LLM response:\n${response}`);

        // const jsonExtracted = extractCodeBlockContents(response);
        // console.log(`JSON extracted:\n${jsonExtracted}`);

        // const evalResponse = JSON.parse(jsonExtracted);

        // console.log(`parsed json:\n${JSON.stringify(evalResponse)}`);

        // TODO: return eval result
        // return evalResponse;
        return '';
      } else {
        throw new Error('invalid response from LLM');
      }
    } catch (e) {
      console.error(
        `Exception occurred while evaluating response: ${
          chatResponse || ''
        }\n Error: ${e}`,
      );
      if (retryCount < 10) {
        retryCount++;
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      } else {
        throw new Error('Max retry attempts reached. Evaluation failed.');
      }
    }
  }
}


async function main() {
  const program = new Command();
  program
    .name('evalResponse')
    .description('Evaluate chat bot responses')
    .version('0.1.0');

  program
  .option('--skip <number>, ', 'how many rows to skip', '0')
  .option('--take <number>, ', 'how many rows to process', '20');

  program.parse(process.argv);
  const opts = program.opts();

  let collectionNameTmp = opts.collection;
  const skipCount = opts.skip;
  const takeCount = opts.take;
  
  

  // create single supabase client
  const supabase: SupabaseClient = createClient(
    envVar('SLACK_APP_SUPABASE_API_URL'),
    envVar('SLACK_APP_SUPABASE_ADMIN_KEY'),
  );


  const { data, error: retrievalError } = await supabase
    .from('slack_message')
    .select('*')
    .range(skipCount, skipCount + takeCount - 1)
    .eq('step_name', 'rag_with_typesense');

  if (retrievalError) {
    console.error('Error retrieving data:', retrievalError);
    return;
  }

  // Extract text from row.content.english_answer for each row
  // console.log(`Retrieved data: ${JSON.stringify(data)}`)

  const extractedTexts = data.map(row => row?.content?.english_answer?.slice(0, 1000) || '');

  let index = 0;
  for (const responseText of extractedTexts) {
    console.log(`Evaluating text #${index}:\n${responseText}`);
    await evalRetrievalSuccess(responseText);
    index++;
  }

}

await main();


