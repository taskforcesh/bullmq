import { expect } from 'chai';
import { convertExecArgv } from '../src/classes/child';

describe('child', () => {
  describe('convertExecArgv', () => {
    it('should filter out --inspect-publish-uid flag', async () => {
      const execArgv = ['--inspect-publish-uid=stderr,http', '--another-flag'];
      const result = await convertExecArgv(execArgv);
      expect(result).to.deep.equal([]); // Should be empty as only --inspect and --inspect-brk are allowed.
    });

    it('should filter out other unsupported flags like --stack-trace-limit', async () => {
      const execArgv = ['--stack-trace-limit=10', '--another-flag'];
      const result = await convertExecArgv(execArgv);
      expect(result).to.deep.equal([]); // Should be empty
    });

    it('should replace port for --inspect flag', async () => {
      const execArgv = ['--inspect=9229', '--another-flag'];
      const result = await convertExecArgv(execArgv);
      expect(result.length).to.equal(1); // Only --inspect will be in the result
      expect(result[0]).to.not.equal('--inspect=9229');
      expect(result[0]).to.match(/^--inspect=/);
    });

    it('should replace port for --inspect-brk flag', async () => {
      const execArgv = ['--inspect-brk=9229', '--another-flag'];
      const result = await convertExecArgv(execArgv);
      expect(result.length).to.equal(1); // Only --inspect-brk will be in the result
      expect(result[0]).to.not.equal('--inspect-brk=9229');
      expect(result[0]).to.match(/^--inspect-brk=/);
    });
  });
});
