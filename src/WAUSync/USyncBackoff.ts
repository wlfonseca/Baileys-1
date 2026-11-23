import type { USyncQuery, USyncQueryError } from './USyncQuery'

/**
 * Pausa pedida pelo servidor por protocolo do usync, como o WAWebUsyncBackoff do
 * WhatsApp Web: o erro do protocolo traz `backoff` em segundos e as consultas
 * seguintes daquele protocolo esperam. Não espera em consulta `interactive` (a pessoa
 * digitando um número) nem em `devices` no envio de mensagem ou chamada.
 */
export class USyncBackoff {
	private pending = new Map<string, { promise: Promise<void>; until: number }>()

	setProtocolBackoffMs(protocol: string, ms: number) {
		const until = Date.now() + ms
		const promise = new Promise<void>(resolve => {
			const timer = setTimeout(resolve, ms)
			timer.unref?.()
		})
		this.pending.set(protocol, { promise, until })
	}

	applyResultErrors(errors: { [protocol: string]: USyncQueryError } | undefined) {
		for (const [protocol, error] of Object.entries(errors || {})) {
			if (typeof error?.backoff === 'number' && error.backoff > 0) {
				this.setProtocolBackoffMs(protocol, error.backoff * 1000)
			}
		}
	}

	remainingMs(protocol: string) {
		const entry = this.pending.get(protocol)
		return entry ? Math.max(0, entry.until - Date.now()) : 0
	}

	shouldWait(query: USyncQuery) {
		if (query.context === 'interactive') {
			return false
		}

		const names = query.protocols.map(p => p.name)
		return !(names.includes('devices') && (query.context === 'message' || query.context === 'voip'))
	}

	async waitForBackoff(query: USyncQuery) {
		if (!this.shouldWait(query)) {
			return
		}

		await Promise.all(query.protocols.map(p => this.pending.get(p.name)?.promise))
	}
}
