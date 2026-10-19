/** Preserve upstream unit fixtures while production starts remain guarded. */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

delete process.env.TMUX
process.env.TMUX_TMPDIR = mkdtempSync(join(tmpdir(), 'board-test-tmux-'))
process.env.NODE_ENV = 'test'
process.env.AGENTBOARD_TEST_TCP = '1'
process.env.AGENTBOARD_TEST_AUTH_BYPASS = '1'
