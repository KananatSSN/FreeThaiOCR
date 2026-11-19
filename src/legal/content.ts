// Privacy policy and terms of use, in Thai and English.
//
// Facts these texts rely on (keep them true when changing the app or server):
// - Files and OCR results never leave the browser (CSP connect-src 'self').
// - nginx keeps no access log (deploy/nginx.conf); error logs are capped
//   (docker-compose.yml logging: 3 x 1 MB).
// - The browser stores only theme / language / GPU preferences, plus the
//   offline cache (service worker) of the app and models.
// - No analytics, ads, accounts or tracking cookies. Cloudflare may set a
//   security cookie (e.g. __cf_bm).
// Paragraphs support [link text](https://url) and **bold**.

export type Block = string | { list: string[] }
export interface Section {
  heading: string
  body: Block[]
}
export interface LegalDoc {
  title: string
  updated: string
  intro?: string
  sections: Section[]
}
export interface LegalVars {
  operator: string
  /** "e-mail x@y" or a link to the repository's issues. */
  contact: string
  repoUrl?: string
}

export type LegalKind = 'privacy' | 'terms'
export const LEGAL_PATHS: Record<LegalKind, string> = { privacy: '/privacy', terms: '/terms' }

export const EFFECTIVE_DATE = { en: '16 November 2026', th: '16 พฤศจิกายน 2569' }

const CLOUDFLARE_PRIVACY = 'https://www.cloudflare.com/privacypolicy/'
const PDPC = 'https://www.pdpc.or.th/'

export function privacy(lang: 'th' | 'en', v: LegalVars): LegalDoc {
  if (lang === 'th') {
    return {
      title: 'นโยบายความเป็นส่วนตัว',
      updated: `มีผลตั้งแต่ ${EFFECTIVE_DATE.th}`,
      intro: '**สรุปสั้น ๆ:** รูปภาพและ PDF ของคุณไม่ถูกส่งออกจากเครื่อง การ OCR ทำงานในเบราว์เซอร์ของคุณทั้งหมด เราไม่มีระบบบัญชีผู้ใช้ ไม่มีโฆษณา ไม่มีระบบวิเคราะห์การใช้งาน และไม่มีคุกกี้ติดตาม',
      sections: [
        { heading: 'เราคือใคร', body: [`FreeThaiOCR เป็นเว็บแอปโอเพนซอร์สที่ใช้งานได้ฟรี ดำเนินการโดย ${v.operator} ("เรา") ติดต่อเราได้ที่ ${v.contact}`] },
        {
          heading: 'ข้อมูลที่เราไม่เก็บ',
          body: [
            'ไฟล์ที่คุณเปิด ข้อความที่ได้จากการ OCR ชื่อไฟล์ การแก้ไข และไฟล์ที่ส่งออก ถูกประมวลผลในหน่วยความจำของเบราว์เซอร์บนเครื่องของคุณเท่านั้น ไม่มีการอัปโหลดหรือจัดเก็บบนเซิร์ฟเวอร์ของเรา เมื่อปิดหน้าเว็บ ข้อมูลเหล่านี้จะหายไป',
          ],
        },
        {
          heading: 'ข้อมูลที่ถูกประมวลผลเมื่อคุณเข้าเว็บไซต์',
          body: [
            `**ผู้ให้บริการเครือข่าย:** เว็บไซต์ให้บริการผ่าน Cloudflare, Inc. ซึ่งดูแลการรับส่งข้อมูล ความปลอดภัย (ป้องกันการโจมตี) และการแคช เพื่อส่งเว็บไซต์ถึงคุณ Cloudflare จำเป็นต้องประมวลผลข้อมูลทางเทคนิค เช่น หมายเลข IP ข้อมูลเบราว์เซอร์ (user agent) และ URL ที่ร้องขอ และอาจตั้งคุกกี้ด้านความปลอดภัยที่จำเป็น (เช่น __cf_bm) เพื่อแยกผู้ใช้จริงออกจากบอท Cloudflare ประมวลผลข้อมูลนี้ในนามของเราตามข้อกำหนดการประมวลผลข้อมูลและ[นโยบายความเป็นส่วนตัวของ Cloudflare](${CLOUDFLARE_PRIVACY}) เซิร์ฟเวอร์ของ Cloudflare ตั้งอยู่ในหลายประเทศรวมถึงนอกประเทศไทย ซึ่งถือเป็นการส่งข้อมูลไปต่างประเทศ โดย Cloudflare มีมาตรการคุ้มครองตามข้อกำหนดการประมวลผลข้อมูลของบริษัท`,
            '**เซิร์ฟเวอร์ของเรา:** ไม่บันทึกประวัติการเข้าใช้งาน (access log) จึงไม่เก็บหมายเลข IP หรือข้อมูลว่าคุณเปิดหน้าใด ระบบอาจบันทึกข้อผิดพลาดของเซิร์ฟเวอร์ (ไม่มีไฟล์ของคุณ) เพื่อแก้ไขปัญหา โดยจำกัดขนาดและถูกเขียนทับโดยอัตโนมัติ',
            '**ฐานทางกฎหมาย:** ประโยชน์โดยชอบด้วยกฎหมายในการให้บริการเว็บไซต์และรักษาความปลอดภัย ตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 มาตรา 24(5)',
          ],
        },
        {
          heading: 'ข้อมูลที่เก็บบนเครื่องของคุณ',
          body: [
            {
              list: [
                'ค่าที่คุณเลือก ได้แก่ ธีม (สว่าง/มืด) ภาษา และการใช้ GPU จัดเก็บใน local storage ของเบราว์เซอร์ และไม่ถูกส่งมาให้เรา',
                'สำเนาของแอปและโมเดล OCR ในแคชของเบราว์เซอร์ (service worker) เพื่อให้โหลดเร็วและใช้งานแบบออฟไลน์ได้',
              ],
            },
            'คุณลบข้อมูลเหล่านี้ได้ทุกเมื่อจากการตั้งค่าเบราว์เซอร์ (ล้างข้อมูลเว็บไซต์)',
          ],
        },
        {
          heading: 'ลิงก์ไปยังเว็บไซต์อื่น',
          body: ['แอปมีลิงก์ไปยัง GitHub, Hugging Face และ (ถ้ามี) Ko-fi เว็บไซต์เหล่านี้มีนโยบายความเป็นส่วนตัวของตนเอง และจะได้รับข้อมูลจากคุณเฉพาะเมื่อคุณกดลิงก์เท่านั้น'],
        },
        {
          heading: 'การสนับสนุนผู้พัฒนา',
          body: [
            'การโอนเงินผ่านพร้อมเพย์เกิดขึ้นในแอปธนาคารของคุณ ระหว่างคุณกับธนาคาร เว็บไซต์นี้ไม่ได้รับข้อมูลบัญชีหรือบัตรของคุณ ผู้รับจะเห็นเฉพาะข้อมูลที่ธนาคารแสดงตามปกติ (เช่น ชื่อผู้โอนและจำนวนเงิน) หากใช้ Ko-fi การชำระเงินจะเป็นไปตามนโยบายของ Ko-fi',
          ],
        },
        {
          heading: 'สิทธิของคุณ',
          body: [
            `ตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 คุณมีสิทธิขอเข้าถึงและขอรับสำเนา ขอแก้ไข ขอลบ ขอระงับการใช้ คัดค้านการประมวลผล และขอโอนย้ายข้อมูลส่วนบุคคลของคุณ รวมถึงร้องเรียนต่อ[สำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคล (สคส.)](${PDPC}) เนื่องจากเราแทบไม่เก็บข้อมูลส่วนบุคคล คำขอส่วนใหญ่จะเกี่ยวกับข้อมูลที่ Cloudflare ประมวลผล ติดต่อเราได้ที่ ${v.contact}`,
          ],
        },
        { heading: 'ผู้เยาว์', body: ['บริการนี้ไม่มีระบบบัญชีผู้ใช้ และเราไม่ได้ตั้งใจเก็บข้อมูลส่วนบุคคลของผู้ใดรวมถึงผู้เยาว์'] },
        { heading: 'การเปลี่ยนแปลงนโยบาย', body: ['หากมีการเปลี่ยนแปลง เราจะปรับปรุงหน้านี้และวันที่มีผลด้านบน'] },
      ],
    }
  }
  return {
    title: 'Privacy Policy',
    updated: `Effective ${EFFECTIVE_DATE.en}`,
    intro: '**The short version:** your images and PDFs never leave your device. OCR runs entirely in your browser. There are no accounts, no ads, no analytics and no tracking cookies.',
    sections: [
      { heading: 'Who we are', body: [`FreeThaiOCR is a free, open-source web app operated by ${v.operator} ("we"). You can contact us at ${v.contact}.`] },
      {
        heading: 'What we do not collect',
        body: [
          'The files you open, the recognised text, file names, your edits and your exports are processed in your browser’s memory on your device only. Nothing is uploaded to or stored on our servers. Closing the page discards them.',
        ],
      },
      {
        heading: 'What is processed when you visit',
        body: [
          `**Network provider:** the site is delivered through Cloudflare, Inc., which handles traffic, security (protection against attacks) and caching. To deliver the site, Cloudflare necessarily processes technical data such as your IP address, browser user agent and the URLs requested, and may set a strictly necessary security cookie (such as __cf_bm) to tell people from bots. Cloudflare processes this on our behalf under its data processing terms and the [Cloudflare Privacy Policy](${CLOUDFLARE_PRIVACY}). Its servers are in many countries, including outside Thailand, so this involves a cross-border transfer, covered by the safeguards in Cloudflare’s data processing terms.`,
          '**Our server:** keeps no access log, so it does not record IP addresses or which pages you open. It may record server errors (never your files) for troubleshooting; these logs are size-limited and overwritten automatically.',
          '**Legal basis:** legitimate interests in delivering and securing the site, under section 24(5) of Thailand’s Personal Data Protection Act B.E. 2562 (2019).',
        ],
      },
      {
        heading: 'What is stored on your device',
        body: [
          {
            list: [
              'Your choices of theme (light/dark), language and GPU use, in your browser’s local storage. They are never sent to us.',
              'A copy of the app and the OCR models in your browser’s cache (service worker), so it loads fast and works offline.',
            ],
          },
          'You can remove these at any time by clearing this site’s data in your browser settings.',
        ],
      },
      {
        heading: 'Links to other sites',
        body: ['The app links to GitHub, Hugging Face and (if shown) Ko-fi. Those sites have their own privacy policies and receive information from you only if you follow a link.'],
      },
      {
        heading: 'Supporting the developer',
        body: [
          'PromptPay transfers happen in your banking app, between you and your bank. This site never receives your account or card details; the recipient sees only what banks normally show (such as the sender’s name and the amount). If you use Ko-fi, the payment is handled under Ko-fi’s policies.',
        ],
      },
      {
        heading: 'Your rights',
        body: [
          `Under Thailand’s Personal Data Protection Act you have the right to access and obtain a copy of, correct, delete, restrict and object to the processing of your personal data, and to data portability. You may also complain to the [Office of the Personal Data Protection Committee (PDPC)](${PDPC}). Because we hold almost no personal data, most requests will concern data processed by Cloudflare. Contact us at ${v.contact}.`,
        ],
      },
      { heading: 'Children', body: ['There are no accounts, and we do not knowingly collect personal data from anyone, including children.'] },
      { heading: 'Changes', body: ['If this policy changes, we will update this page and the effective date above.'] },
    ],
  }
}

export function terms(lang: 'th' | 'en', v: LegalVars): LegalDoc {
  const licenses = '/licenses.txt'
  if (lang === 'th') {
    return {
      title: 'ข้อกำหนดการใช้งาน',
      updated: `มีผลตั้งแต่ ${EFFECTIVE_DATE.th}`,
      sections: [
        { heading: 'การยอมรับข้อกำหนด', body: [`เมื่อใช้ FreeThaiOCR ถือว่าคุณยอมรับข้อกำหนดนี้ บริการนี้ให้ใช้งานฟรีโดย ${v.operator}`] },
        {
          heading: 'ความถูกต้องของผลลัพธ์',
          body: ['บริการนี้ให้ "ตามสภาพ" โดยไม่มีการรับประกันใด ๆ ผลการ OCR อาจผิดพลาด โดยเฉพาะลายมือ ภาพถ่ายป้าย และฟอนต์ตกแต่ง กรุณาตรวจสอบผลลัพธ์ทุกครั้งก่อนนำไปใช้ โดยเฉพาะเอกสารทางกฎหมาย การแพทย์ หรือการเงิน'],
        },
        { heading: 'เนื้อหาของคุณ', body: ['คุณต้องมีสิทธิในการประมวลผลเอกสารที่เปิดในแอป และรับผิดชอบต่อการใช้งานผลลัพธ์เอง ไฟล์ของคุณอยู่บนเครื่องของคุณเท่านั้น เราจึงไม่เห็นและไม่ตรวจสอบเนื้อหา'] },
        { heading: 'การใช้งานที่ไม่อนุญาต', body: ['ห้ามพยายามรบกวนหรือทำให้บริการหยุดทำงาน เช่น การโจมตีเครือข่ายหรือการส่งคำขออัตโนมัติจำนวนมาก'] },
        {
          heading: 'โอเพนซอร์สและสัญญาอนุญาต',
          body: [
            `ซอร์สโค้ดของ FreeThaiOCR ใช้สัญญาอนุญาต Apache License 2.0${v.repoUrl ? ` ([ดูซอร์สโค้ด](${v.repoUrl}))` : ''} โมเดล OpenThai 2.1 OCR Text เป็นของ iApp Technology และโมเดล AksonOCR-Lite (เครื่องมือ OCR ทางเลือก) เป็นของ Teetouch Jaknamon (Remtir) ทั้งสองใช้สัญญาอนุญาต Apache License 2.0 และซอฟต์แวร์อื่นที่ใช้มีสัญญาอนุญาตของตนเอง ดู[รายการสัญญาอนุญาตทั้งหมด](${licenses})`,
          ],
        },
        {
          heading: 'เครื่องหมายการค้าและความเกี่ยวข้อง',
          body: ['FreeThaiOCR ไม่มีส่วนเกี่ยวข้องและไม่ได้รับการรับรองจาก iApp Technology, Hugging Face, PaddlePaddle, GitHub, ธนาคารกรุงไทย หรือพร้อมเพย์ ชื่อและเครื่องหมายการค้าเป็นของเจ้าของแต่ละราย'],
        },
        {
          heading: 'การสนับสนุนผู้พัฒนา',
          body: ['การสนับสนุนเป็นไปโดยสมัครใจ ไม่สามารถขอคืนได้ และใช้เป็นค่าพัฒนาและค่าเซิร์ฟเวอร์ ไม่ใช่การบริจาคเพื่อการกุศล ไม่สามารถนำไปลดหย่อนภาษีได้ และไม่มีสินค้าหรือบริการตอบแทน'],
        },
        { heading: 'ข้อจำกัดความรับผิด', body: ['ภายในขอบเขตที่กฎหมายอนุญาต เราไม่รับผิดต่อความเสียหายใด ๆ ที่เกิดจากการใช้หรือไม่สามารถใช้บริการ รวมถึงความผิดพลาดของผลการ OCR'] },
        { heading: 'การเปลี่ยนแปลงและกฎหมายที่ใช้บังคับ', body: ['เราอาจปรับปรุงข้อกำหนดนี้และจะแสดงวันที่มีผลด้านบน ข้อกำหนดนี้อยู่ภายใต้กฎหมายแห่งราชอาณาจักรไทย'] },
        { heading: 'ติดต่อ', body: [`ติดต่อเราได้ที่ ${v.contact}`] },
      ],
    }
  }
  return {
    title: 'Terms of Use',
    updated: `Effective ${EFFECTIVE_DATE.en}`,
    sections: [
      { heading: 'Agreement', body: [`By using FreeThaiOCR you agree to these terms. The service is provided free of charge by ${v.operator}.`] },
      {
        heading: 'Accuracy',
        body: ['The service is provided "as is", without warranty of any kind. OCR results can be wrong, especially for handwriting, photos of signs and decorative fonts. Always check the results before relying on them, particularly for legal, medical or financial documents.'],
      },
      { heading: 'Your content', body: ['You must have the right to process the documents you open, and you are responsible for how you use the results. Your files stay on your device, so we never see or review them.'] },
      { heading: 'Acceptable use', body: ['Do not attempt to disrupt or overload the service, for example with network attacks or large volumes of automated requests.'] },
      {
        heading: 'Open source and licenses',
        body: [
          `FreeThaiOCR’s source code is licensed under the Apache License 2.0${v.repoUrl ? ` ([view the source](${v.repoUrl}))` : ''}. The OpenThai 2.1 OCR Text model is by iApp Technology and the optional AksonOCR-Lite engine is by Teetouch Jaknamon (Remtir), both under the Apache License 2.0. Other included software is used under its own license; see the [full list of licenses](${licenses}).`,
        ],
      },
      {
        heading: 'Trademarks and affiliation',
        body: ['FreeThaiOCR is not affiliated with or endorsed by iApp Technology, Hugging Face, PaddlePaddle, GitHub, Krungthai Bank or PromptPay. Names and trademarks belong to their respective owners.'],
      },
      {
        heading: 'Supporting the developer',
        body: ['Support payments are voluntary, non-refundable gifts that fund development and hosting. They are not charitable donations, are not tax-deductible, and do not buy any goods or services.'],
      },
      { heading: 'Limitation of liability', body: ['To the extent permitted by law, we are not liable for any loss or damage arising from using, or being unable to use, the service, including errors in OCR results.'] },
      { heading: 'Changes and governing law', body: ['We may update these terms; the effective date above will change when we do. These terms are governed by the laws of the Kingdom of Thailand.'] },
      { heading: 'Contact', body: [`Contact us at ${v.contact}.`] },
    ],
  }
}
