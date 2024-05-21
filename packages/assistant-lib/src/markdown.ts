import { envVar } from "./general";

const blockToken = "```";
const sectionDelimiter = "\n\n";

function blockTokenCount(markdown: string): number {
  return markdown.split(blockToken).length - 1;
}

function hasOpenCodeBlock(markdown: string): boolean {
  return blockTokenCount(markdown) % 2 === 1;
}

export function splitToSections(markdown: string | null): string[] {
  if (markdown === null) {
    return [];
  }

  let sections = markdown.split(sectionDelimiter);

  for (let i = 0; i < sections.length; i++) {
    if (hasOpenCodeBlock(sections[i])) {
      let a = i + 1;
      while (hasOpenCodeBlock(sections[i]) && a <= sections.length - 1) {
        if (envVar("LOG_LEVEL") == "debug") {
          console.log(`Merging section ${i} and ${a}`);
        }
        sections[i] =
          (sections[i] || "") + sectionDelimiter + (sections[a] || "");
        sections[a] = "";
        a += 1;
      }
    }
  }

  sections = sections.filter((section) => !isNullOrEmpty(section));

  return sections;
}

export function stripCodeBlockLang(codeBlock: string): string {
  let fixed = codeBlock;
  while (
    fixed.indexOf("```") >= 0 &&
    fixed.indexOf("```") != fixed.indexOf("```\n")
  ) {
    const start = fixed.indexOf("```");
    const lineEnd = fixed.indexOf("\n", start);
    fixed = fixed.substring(0, start + 3) + fixed.substring(lineEnd);
  }
  return fixed;
}

export function isNullOrEmpty(inputStr: string | null | undefined): boolean {
  if (inputStr === undefined || inputStr == null || inputStr == "") {
    return true;
  }
  return false;
}

function logSections(sections: string[]): void {
  sections.forEach((section, i) => {
    console.log(`${i}: ${section}`);
  });
}

// Example usage
// const testMd =
//   'In the context of Altinn Authorization, the term "org" refers to an organization. It is used as a placeholder in authorization rules to represent an organization that is either the owner of an application or an organization that is allowed to perform certain actions within the application.\n\nFor example, in the rule:\n\n```xml\n<xacml:Rule RuleId="urn:altinn:example:ruleid:[RULE_ID]" Effect="Permit">\n <xacml:Description>[ORG_2] can instantiate an instance of [ORG_1]/[APP]</xacml:Description>\n <xacml:Target>\n <xacml:AnyOf>\n <xacml:AllOf>\n <xacml:Match MatchId="urn:oasis:names:tc:xacml:1.0:function:string-equal">\n <xacml:AttributeValue DataType="http://www.w3.org/2001/XMLSchema#string">[ORG_2]</xacml:AttributeValue>\n <xacml:AttributeDesignator AttributeId="urn:altinn:org" Category="urn:oasis:names:tc:xacml:1.0:subject-category:access-subject" DataType="http://www.w3.org/2001/XMLSchema#string" MustBePresent="false"/>\n </xacml:Match>\n </xacml:AllOf>\n </xacml:AnyOf>\n <xacml:AnyOf>\n <xacml:AllOf>\n <xacml:Match MatchId="urn:oasis:names:tc:xacml:1.0:function:string-equal">\n <xacml:AttributeValue DataType="http://www.w3.org/2001/XMLSchema#string">[ORG_1]</xacml:AttributeValue>\n <xacml:AttributeDesignator AttributeId="urn:altinn:org" Category="urn:oasis:names:tc:xacml:3.0:attribute-category:resource" DataType="http://www.w3.org/2001/XMLSchema#string" MustBePresent="false"/>\n </xacml:Match>\n <xacml:Match MatchId="urn:oasis:names:tc:xacml:1.0:function:string-equal">\n <xacml:AttributeValue DataType="http://www.w3.org/2001/XMLSchema#string">[APP]</xacml:AttributeValue>\n <xacml:AttributeDesignator AttributeId="urn:altinn:app" Category="urn:oasis:names:tc:xacml:3.0:attribute-category:resource" DataType="http://www.w3.org/2001/XMLSchema#string" MustBePresent="false"/>\n </xacml:Match>\n </xacml:AllOf>\n </xacml:AnyOf>\n <xacml:AnyOf>\n <xacml:AllOf>\n <xacml:Match MatchId="urn:oasis:names:tc:xacml:1.0:function:string-equal">\n <xacml:AttributeValue DataType="http://www.w3.org/2001/XMLSchema#string">instantiate</xacml:AttributeValue>\n <xacml:AttributeDesignator AttributeId="urn:oasis:names:tc:xacml:1.0:action:action-id" Category="urn:oasis:names:tc:xacml:3.0:attribute-category:action" DataType="http://www.w3.org/2001/XMLSchema#string" MustBePresent="false"/>\n </xacml:Match>\n </xacml:AllOf>\n </xacml:AnyOf>\n </xacml:Target>\n</xacml:Rule>\n```\n\nHere, `[ORG_1]` and `[ORG_2]` are placeholders for the organization identifiers. `[ORG_1]` corresponds to the application owner, and `[ORG_2]` is another organization allowed to instantiate an instance of the application.\n\nSimilarly, in JSON format:\n\n```json\n{\n "$schema": "https://altinncdn.no/schemas/json/policy/policy.schema.v1.json",\n "Policy": {\n "Rules": [\n {\n "Effect": "Permit",\n "Description": "[ORG_2] can instantiate an instance of [ORG_1]/[APP]",\n "Subjects": [\n "org:[ORG_2]"\n ],\n "Resources": [\n "app:[ORG_1]/[APP]"\n ],\n "Actions": [\n "instantiate"\n ]\n }\n ]\n }\n}\n```\n\nIn this JSON example, `org:[ORG_2]` and `app:[ORG_1]/[APP]` are used to define the subjects and resources involved in the rule.\n\nS';
// const fixedCodeBlock = stripCodeBlockLang(testMd);
// console.log("result" + fixedCodeBlock);
