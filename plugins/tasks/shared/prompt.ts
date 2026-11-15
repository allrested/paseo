/** What a task's prompt reads when the user has written no template of their own. */
export const DEFAULT_PROMPT = "Work on {key}: {title}\n\n{description}\n\n{url}";

/** The words a template can hold, as the settings screen names them. */
export const PROMPT_WORDS = "{key}, {title}, {description} and {url}";

export interface PromptTask {
  key: string;
  title: string;
  description: string;
  url: string;
}

/**
 * A template with a task's words in it. Each word is filled in one pass, so the task's own text
 * is not read for words, and a task with no description leaves no gap.
 */
export function fillPrompt(template: string, task: PromptTask): string {
  const source = template.trim() === "" ? DEFAULT_PROMPT : template;
  return source
    .replace(/\{(key|title|description|url)\}/g, (_word, name: keyof PromptTask) =>
      task[name].trim(),
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
