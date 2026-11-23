import { jest } from '@jest/globals'
import { USyncBackoff } from '../../WAUSync/USyncBackoff'
import { USyncQuery } from '../../WAUSync/USyncQuery'

const resultNode = (protocolErrors: { [protocol: string]: { code: string; text: string; backoff?: string } }) => ({
	tag: 'iq',
	attrs: { type: 'result' },
	content: [
		{
			tag: 'usync',
			attrs: {},
			content: [
				{
					tag: 'result',
					attrs: {},
					content: Object.entries(protocolErrors).map(([protocol, error]) => ({
						tag: protocol,
						attrs: {},
						content: [{ tag: 'error', attrs: error }]
					}))
				},
				{ tag: 'list', attrs: {}, content: [] }
			]
		}
	]
})

describe('USyncQuery: erros por protocolo', () => {
	it('lê código, texto e backoff (segundos) do erro do protocolo', () => {
		const query = new USyncQuery().withContactProtocol()
		const result = query.parseUSyncQueryResult(
			resultNode({ contact: { code: '429', text: 'rate-overlimit', backoff: '120' } })
		)
		expect(result?.errors).toEqual({ contact: { code: 429, text: 'rate-overlimit', backoff: 120 } })
		expect(result?.list).toEqual([])
	})

	it('sem erro: errors vazio', () => {
		const query = new USyncQuery().withContactProtocol()
		expect(query.parseUSyncQueryResult(resultNode({}))?.errors).toEqual({})
	})

	it('erro sem backoff: backoff fica indefinido', () => {
		const query = new USyncQuery().withContactProtocol()
		const result = query.parseUSyncQueryResult(resultNode({ contact: { code: '500', text: 'internal' } }))
		expect(result?.errors.contact).toEqual({ code: 500, text: 'internal', backoff: undefined })
	})
})

describe('USyncBackoff (como o WAWebUsyncBackoff)', () => {
	beforeEach(() => jest.useFakeTimers())
	afterEach(() => jest.useRealTimers())

	const settled = async (promise: Promise<unknown>) => {
		let done = false
		promise.then(() => (done = true))
		for (let i = 0; i < 10; i++) {
			await Promise.resolve()
		}

		return done
	}

	it('consulta em background espera a pausa do protocolo', async () => {
		const backoff = new USyncBackoff()
		backoff.setProtocolBackoffMs('contact', 120_000)
		const waiting = backoff.waitForBackoff(new USyncQuery().withContactProtocol().withContext('background'))
		expect(await settled(waiting)).toBe(false)
		jest.advanceTimersByTime(120_000)
		expect(await settled(waiting)).toBe(true)
	})

	it('consulta interactive (pessoa digitando) não espera', async () => {
		const backoff = new USyncBackoff()
		backoff.setProtocolBackoffMs('contact', 120_000)
		expect(await settled(backoff.waitForBackoff(new USyncQuery().withContactProtocol()))).toBe(true)
	})

	it('devices no envio de mensagem não espera', async () => {
		const backoff = new USyncBackoff()
		backoff.setProtocolBackoffMs('devices', 120_000)
		const query = new USyncQuery().withContext('message').withDeviceProtocol()
		expect(await settled(backoff.waitForBackoff(query))).toBe(true)
	})

	it('pausa de outro protocolo não segura a consulta', async () => {
		const backoff = new USyncBackoff()
		backoff.setProtocolBackoffMs('status', 120_000)
		const query = new USyncQuery().withContactProtocol().withContext('background')
		expect(await settled(backoff.waitForBackoff(query))).toBe(true)
	})

	it('applyResultErrors grava a pausa em ms a partir dos segundos do servidor', async () => {
		const backoff = new USyncBackoff()
		backoff.applyResultErrors({ contact: { code: 429, text: 'rate-overlimit', backoff: 30 } })
		expect(backoff.remainingMs('contact')).toBe(30_000)
		jest.advanceTimersByTime(30_000)
		expect(backoff.remainingMs('contact')).toBe(0)
	})
})
