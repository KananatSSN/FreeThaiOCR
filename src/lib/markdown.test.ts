import { describe, expect, it } from 'vitest'
import { markdownToText } from './markdown'

describe('markdownToText', () => {
  it('strips headings and figure markers, turns tables into tab-separated rows', () => {
    const md = ['## ใบแจ้งหนี้', 'ลูกค้า บริษัท', '<table>', '<tr>', '<th>รายการ</th>', '<th colspan="2">ราคา &amp; ภาษี</th>', '</tr>', '<tr>', '<td>กระดาษ</td>', '<td></td>', '<td>2,500.00</td>', '</tr>', '</table>', '<figure>', '</figure>', 'จบ'].join('\n')
    expect(markdownToText(md)).toBe(['ใบแจ้งหนี้', 'ลูกค้า บริษัท', 'รายการ\tราคา & ภาษี', 'กระดาษ\t\t2,500.00', 'จบ'].join('\n'))
  })
  it('leaves plain text alone', () => {
    expect(markdownToText('บรรทัดหนึ่ง\nบรรทัดสอง')).toBe('บรรทัดหนึ่ง\nบรรทัดสอง')
  })
})
