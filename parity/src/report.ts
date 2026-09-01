import { appendFile } from 'node:fs/promises';
import {
  OneSidedScripResults,
  ParityTestCase,
  TestCaseEvaluationResult,
} from './types';

interface CaseIssue {
  description: string;
  job_issues: string[];
}

export class TestReportBuilder {
  private rows: string[] = [];
  private producerIssues: CaseIssue[] = [];
  private consumerIssues: CaseIssue[] = [];
  private passed = 0;
  private failed = 0;

  constructor(
    private title: string,
    private defintions: ParityTestCase[],
    private consumerResult: OneSidedScripResults,
    private producerResult: OneSidedScripResults,
  ) {
    this.processResults();
  }

  private generateIssue(
    definition: ParityTestCase,
    result: TestCaseEvaluationResult,
  ) {
    const job_issues = result.issues.splice(0, 3);
    if (result.issues.length > 0) {
      job_issues.push(`... ${result.issues.length} more, see logs`);
    }

    return {
      description: `${definition.name} - ${definition.id}`,
      job_issues,
    };
  }

  private addResultItem(
    definition: ParityTestCase,
    consumerResult: TestCaseEvaluationResult,
    producerResult: TestCaseEvaluationResult,
  ) {
    const consumerMark = consumerResult.pass ? '✓' : 'x';
    const producerMark = producerResult.pass ? '✓' : 'x';
    const { id, name, description } = definition;
    const row = `| ${id} | ${name} | ${consumerMark} | ${[producerMark]} | ${description} |`;
    this.rows.push(row);
    if (!consumerResult.pass) {
      this.consumerIssues.push(this.generateIssue(definition, consumerResult));
    }
    if (!producerResult.pass) {
      this.producerIssues.push(this.generateIssue(definition, producerResult));
    }
    if (consumerResult.pass && producerResult.pass) {
      this.passed++;
    } else {
      this.failed++;
    }
  }

  private processResults() {
    if (
      !this.consumerResult.isSupported ||
      !this.producerResult.isSupported ||
      !this.consumerResult.launched ||
      !this.producerResult.launched
    ) {
      return;
    }

    for (let i = 0; i < this.defintions.length; i++) {
      this.addResultItem(
        this.defintions[i],
        this.consumerResult.caseResults[i],
        this.producerResult.caseResults[i],
      );
    }
  }

  private get isSupported() {
    return this.consumerResult.isSupported && this.producerResult.isSupported;
  }

  private get launched() {
    return this.consumerResult.launched && this.producerResult.launched;
  }

  hasPassed() {
    // Unsupported backends are given a through pass
    if (!this.isSupported) {
      return true;
    }

    return (
      this.launched &&
      this.failed === 0 &&
      this.passed === this.defintions.length &&
      this.consumerResult.unknownEvents === 0 &&
      this.producerResult.unknownEvents === 0
    );
  }

  async buildAndWrite() {
    let titleMark = '🟢';
    let color = 'green';
    const hasPassed = this.hasPassed();
    if (!this.consumerResult.isSupported || !this.producerResult.isSupported) {
      titleMark = `⚫️`;
      color = 'grey';
    } else if (!hasPassed) {
      titleMark = '🔴';
      color = 'red';
    }

    const outputSections: string[] = [
      '',
      `### ${titleMark}  ${this.title}`,
      '',
    ];

    let message = `**All ${this.passed} tests passed.**`;
    if (!this.isSupported) {
      message = '**Backend not supported** - this test was skipped';
    } else if (!this.launched) {
      message =
        '**Some scripts failed to launch**, see the logs for more details';
    } else if (this.failed > 0) {
      message = `**${this.passed}/${this.passed + this.failed} tests passed.** Check the details below`;
    }

    outputSections.push(message, '');

    if (
      this.consumerResult.unknownEvents > 0 ||
      this.producerResult.unknownEvents > 0
    ) {
      outputSections.push(
        "Some scripts produced events that couldn't be matched to any test, see logs for more details",
        '',
      );
    }

    // Create per case tables only if the test was run
    if (this.isSupported && this.launched) {
      outputSections.push(
        '| Test Id | Name | As Consumer | As Producer | Description |',
        '| :------ | :--- | :---------: | :---------: | :---------- |',
        ...this.rows,
        '',
      );

      if (this.consumerIssues.length > 0) {
        outputSections.push(
          ...this.renderIssues(
            'Issues as Consumer from Node.JS',
            this.consumerIssues,
          ),
        );
      }

      if (this.producerIssues.length > 0) {
        outputSections.push(
          ...this.renderIssues(
            'Issues as Producer to Node.JS',
            this.producerIssues,
          ),
        );
      }
    }

    await appendFile('./parity/REPORT.md', outputSections.join('\n'), 'utf-8');
  }

  renderIssues(title: string, issues: CaseIssue[]): string[] {
    const sections = ['<details>', `<summary>${title}</summary>`, '<ul>'];

    for (const caseIssue of issues) {
      sections.push(
        `\t<li>`,
        caseIssue.description,
        '\t\t<ul>',
        ...caseIssue.job_issues.map(issue => `\t\t\t<li>${issue}</li>`),
        '\t\t</ul>',
        '\t</li>',
      );
    }

    sections.push('</ul>', '</details>', '');
    return sections;
  }
}
