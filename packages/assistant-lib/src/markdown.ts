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
const testMd = `Your test markdown string here...`;
const sections = splitToSections(testMd);
logSections(sections);
