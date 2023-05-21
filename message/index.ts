import { Message, Sayable } from 'wechaty'
import { FileBox } from 'file-box'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

import config from '../config'
import { chat, draw, drawWithMJ } from '../lib/reply'
import { pickBy, pick } from 'midash'
import { throttle } from 'lodash'
import { uploadOSS } from '../lib/upload'

type Route = {
  handle: ((text: string, msg: Message) => Sayable) | ((text: string, msg: Message) => Promise<Sayable>)
  keyword: string | RegExp
  filter?: (msg: Message) => boolean | Promise<boolean>
}

export const routes: Route[] = [
  {
    keyword: '/ping',
    handle() {
      return 'pong'
    },
  },
  {
    keyword: '收到红包，请在手机上查看',
    handle() {
      // 后续在这里给发红包的人加次数
      return ''
    },
    filter() {
      return false
    }
  },
  {
    keyword: '[收到一条微信转账消息，请在手机上查看]',
    handle() {
      return ''
    },
    filter() {
      return false
    }
  },
  {
    keyword: /^画/,
    async handle(text, msg) {
      text = text
        .replace(/^画/, '')
      await msg.say('🤖 正在绘制中，请稍后...')
      // const url = await draw(text)
      const uri = await drawWithMJ(text, throttle((uri, progress) => {
        // msg.say(`🤖 正在绘制中，完成进度 ${progress}`).catch(() => {})
      }, 60000))
      const url = await uploadOSS(uri)
      const prefix = msg.room() ? `@${msg.talker().name()} ` : ''
      await msg.say(`${prefix}🤖 绘制完成

提示词：${text}
图像高清地址：${uri}
国内高清地址：${url}
`)
      // TODO: 个人微信 web 协议不支持 webp
      const webp = process.env.WECHATY_PUPPET === 'wechaty-puppet-wechat' ? '/format,png' : '/format,webp'
      const resizeUrl = `${url}?x-oss-process=image/resize,w_900${webp}`
      const fileBox = FileBox.fromUrl(resizeUrl)
      return fileBox
    }
  },
  {
    keyword: '',
    async handle(text, msg) {
      text = text
        .replace(new RegExp(`^${config.groupPrefix}`), '')
        .replace(new RegExp(`^${config.privatePrefix}`), '')
      const talker = msg.talker()

      const conversation = msg.conversation()

      const key = `Conversation:${conversation.id}:Talker:${talker.id}:Message`
      const answer = await chat(text, config.prompt, key)

      if (msg.room()) {
        const isLontText = text.length > 20
        return `@${talker.name()}  ${text.slice(0, 20)}${isLontText ? '...' : ''}
---------------------------------
${answer}`
      }
      // prisma.message.create({
      //   data: {
      //     text,
      //     reply: answer,
      //     contactName: talker.name(),
      //     contact: {
      //       connectOrCreate: {
      //         create: {
      //           wechatId: talker.id,
      //           name: talker.name(),
      //           ...pick(talker.payload, ['alias', 'avatar', 'gender', 'friend', 'weixin'])
      //         },
      //         where: {
      //           wechatId: talker.id,
      //         }
      //       }
      //     }
      //   }
      // })
      return answer
    },
    async filter(msg) {
      const room = msg.room()
      if (room && config.enableGroup && msg.text().startsWith(config.groupPrefix)) {
        if (config.enableGroup === true) {
          return true
        }
        const topic = await room.topic()
        return config.enableGroup.test(topic)
      }
      if (!room && config.enablePrivate && msg.text().startsWith(config.privatePrefix)) {
        if (config.enablePrivate === true) {
          return true
        }
        return config.enablePrivate.test(msg.talker().name())
      }
      return false
    }
  },
]
