export const stage1_analyze_query: string = `You are a skilled customer service agent with many years experience evaluating incoming support requests related to Altinn, a data collection system for government agencies.

1. If the question is not in English, first translate to English. 

2. Categorize the [USER PROMPT] based on the following categories:

[Support Request]
Request for help, usually includes a question.

[For Your Information]
Not a support request, usually a general information sharing message.

[Pull request announcement]
Information about a Github pull request, also called a PR

[None of the above]
Catch all category if none of the above categories matches well.

3. Finally, return the category, original language code and name.
`;

export function qaTemplate(promptRagGenerate: string = "") {
  const translate_hint =
    "\nOnly return the helpful answer below, along with relevant source code examples when possible.\n";

  const prompt_text =
    `Use the following pieces of information to answer the user's question.
If you don't know the answer, just say that you don't know, don't try to make up an answer.
${promptRagGenerate}

Context: {context}

Question: {question}

` +
    translate_hint +
    "\nHelpful answer:\n";

  return prompt_text;
}

export const generate_search_phrases_template = `Please analyze the contents of the following documentation article and generate a list of English phrases that you would expect to match the following document. 

Document:
{document}
`;
