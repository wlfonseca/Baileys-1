import protobuf from 'protobufjs/minimal.js'
import { proto } from '../../../WAProto/index.js'
import { extractMessageContent, getContentType, normalizeMessageContent } from '../../Utils/messages'

// Figurinha com áudio como chega do WhatsApp (issue #2932): messageContextInfo + audioStickerMessage (134),
// envelope FutureProof com a stickerMessage, que leva premium (24), emojis (25) e audioMessage (26).
const wire = () => {
	const sticker = proto.Message.StickerMessage.encode({
		url: 'https://mmg.whatsapp.net/sticker',
		directPath: '/v/t62.15575-24/sticker',
		mimetype: 'image/webp',
		mediaKey: Buffer.alloc(32, 1),
		fileSha256: Buffer.alloc(32, 3),
		fileEncSha256: Buffer.alloc(32, 4)
	}).finish()
	const audio = proto.Message.AudioMessage.encode({
		url: 'https://mmg.whatsapp.net/audio',
		directPath: '/v/t62.7114-24/audio',
		mimetype: 'audio/ogg; codecs=opus',
		seconds: 3,
		mediaKey: Buffer.alloc(32, 2),
		fileSha256: Buffer.alloc(32, 5),
		fileEncSha256: Buffer.alloc(32, 6)
	}).finish()
	const W = protobuf.Writer
	const stickerFull = Buffer.concat([
		Buffer.from(sticker),
		Buffer.from(
			W.create()
				.uint32((24 << 3) | 0)
				.int32(0)
				.uint32((25 << 3) | 2)
				.string('🎵')
				.uint32((26 << 3) | 2)
				.bytes(audio)
				.finish()
		)
	])
	const inner = W.create()
		.uint32((26 << 3) | 2)
		.bytes(stickerFull)
		.finish()
	const futureProof = W.create()
		.uint32((1 << 3) | 2)
		.bytes(inner)
		.finish()
	const context = proto.MessageContextInfo.encode({ deviceListMetadataVersion: 2 }).finish()
	return W.create()
		.uint32((35 << 3) | 2)
		.bytes(context)
		.uint32((134 << 3) | 2)
		.bytes(futureProof)
		.finish()
}

describe('figurinha com áudio (audioStickerMessage)', () => {
	it('decodifica o envelope 134 com a figurinha e o áudio', () => {
		const msg = proto.Message.decode(wire())
		const sticker = msg.audioStickerMessage?.message?.stickerMessage
		expect(sticker?.mimetype).toBe('image/webp')
		expect(sticker?.premium).toBe(0)
		expect(sticker?.emojis).toBe('🎵')
		expect(sticker?.audioMessage?.mimetype).toBe('audio/ogg; codecs=opus')
		expect(sticker?.audioMessage?.seconds).toBe(3)
		expect(Buffer.from(sticker!.audioMessage!.mediaKey!)).toEqual(Buffer.alloc(32, 2))
	})

	it('normalizeMessageContent e extractMessageContent abrem o envelope como stickerMessage', () => {
		const msg = proto.Message.decode(wire())
		expect(getContentType(msg)).toBe('audioStickerMessage')
		expect(getContentType(normalizeMessageContent(msg))).toBe('stickerMessage')
		expect(getContentType(extractMessageContent(msg))).toBe('stickerMessage')
	})

	it('abre também dentro de ephemeralMessage', () => {
		const inner = proto.Message.decode(wire())
		const msg = proto.Message.fromObject({ ephemeralMessage: { message: inner.toJSON() } })
		const sticker = normalizeMessageContent(msg)?.stickerMessage
		expect(sticker?.audioMessage?.seconds).toBe(3)
	})
})
