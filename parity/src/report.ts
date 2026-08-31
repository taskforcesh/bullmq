import { appendFile } from 'node:fs/promises';
import {
  OneSidedScripResults,
  ParityTestCase,
  TestCaseEvaluationResult,
} from './types';

export class TestReportBuilder {
  private rows: string[] = [];
  private producerIssues: string[] = [];
  private consumerIssues: string[] = [];
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

  private addResultItem(
    definition: ParityTestCase,
    consumerResult: TestCaseEvaluationResult,
    producerResult: TestCaseEvaluationResult,
  ) {
    const consumerMark = consumerResult.status === 'success' ? '✓' : 'x';
    const producerMark = producerResult.status === 'success' ? '✓' : 'x';
    const { id, name, description } = definition;
    const row = `| ${id} | ${name} | ${consumerMark} | ${[producerMark]} | ${description} |`;
    this.rows.push(row);
    if (consumerResult.status === 'failure') {
      this.consumerIssues.push(`\`${id}\` - ${consumerResult.comment}`);
    }
    if (producerResult.status === 'failure') {
      this.producerIssues.push(`\`${id}\` - ${producerResult.comment}`);
    }
    if (
      consumerResult.status === 'success' &&
      producerResult.status === 'success'
    ) {
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
          '<details>',
          '<summary>Issues as Consumer</summary>',
          '<ul>',
          ...this.consumerIssues.map(issue => `<li>${issue}</li>`),
          '</ul>',
          '</details>',
          '',
        );
      }

      if (this.producerIssues.length > 0) {
        outputSections.push(
          '<details>',
          '<summary>Issues as Producer</summary>',
          '<ul>',
          ...this.producerIssues.map(issue => `<li>${issue}</li>`),
          '</ul>',
          '</details>',
          '',
        );
      }
    }

    await appendFile('./parity/REPORT.md', outputSections.join('\n'), 'utf-8');
  }
}
