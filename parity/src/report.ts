import { appendFile } from 'node:fs/promises';
import { ParityTestCase, TestCaseEvaluationResult } from './types';

const REPORT_TEMPLATE = `
---

### {{title}}

{{message}}

| Title | Pass | Test Id | Comment |
| :---- | :--: | :----- | :------ |
{{rows}}
`;

export class TestReportBuilder {
  private rows: string[] = [];

  constructor(public title: string) {}

  addResult(definition: ParityTestCase, result: TestCaseEvaluationResult) {
    const pass_symbol = result.status === 'success' ? '✓' : 'x';
    const row = `| ${definition.title} | ${pass_symbol} | ${definition.id} | ${result.comment} |`;
    this.rows.push(row);
  }

  async buildAndWrite(passed: boolean, message: string, comments: string[]) {
    const title = `${passed ? '🟢' : '🔴'}  ${this.title}`;
    const color = passed ? 'green' : 'red';

    message = `<p style="color: ${color}; font-weight: semibold;">${message}</p>`;
    if (comments.length) {
      message = `${message}\n\n${comments.map(c => `- ${c}`).join('\n')}`;
    }
    const output = REPORT_TEMPLATE.replace('{{title}}', title)
      .replace('{{message}}', message)
      .replace('{{color}}', color)
      .replace('{{rows}}', this.rows.join('\n'));

    await appendFile('./parity/REPORT.md', output, 'utf-8');
  }
}
