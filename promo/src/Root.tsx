import { Composition, Folder, Still } from 'remotion';
import { FacebookPost } from './FacebookPost';
import { Promo } from './Promo';
import { BatchScene } from './scenes/BatchScene';
import { BoxScene } from './scenes/BoxScene';
import { CtaScene } from './scenes/CtaScene';
import { DetectScene } from './scenes/DetectScene';
import { ExportScene } from './scenes/ExportScene';
import { HookScene } from './scenes/HookScene';
import { PrivacyScene } from './scenes/PrivacyScene';
import { ResultsScene } from './scenes/ResultsScene';
import { UploadScene } from './scenes/UploadScene';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="FreeThaiOCR-Promo" component={Promo} durationInFrames={600} fps={30} width={1080} height={1920} defaultProps={{ musicSrc: 'audio/music.mp3', sfxSrc: 'audio/sfx.mp3', musicVolume: 0.9, sfxVolume: 0.6 }} />
      <Folder name="Social">
        <Still
          id="Facebook-Post"
          component={FacebookPost}
          width={1080}
          height={1350}
          defaultProps={{
            headline1: 'เปลี่ยน|*รูปภาพ*',
            headline2: 'เป็น|*ข้อความ*',
            subtitle: 'OCR ภาษาไทย-อังกฤษ ฟรี ในเบราว์เซอร์',
            features: ['อ่านรูปภาพและ PDF', 'ถ่ายจากกล้องมือถือ', 'ลากกรอบ อ่านเฉพาะส่วน', 'ทั้งโฟลเดอร์ ในคลิกเดียว', 'ส่งออก TXT · PDF · ZIP', 'ไฟล์ไม่ถูกอัปโหลด'],
            credit: 'UI สำหรับโมเดล **OpenThai 2.0 OCR Text** โดย iApp Technology',
            url: 'github.com/KananatSSN/FreeThaiOCR',
          }}
        />
      </Folder>
      <Folder name="Scenes">
        <Composition id="Hook" component={HookScene} durationInFrames={64} fps={30} width={1080} height={1920} defaultProps={{ tag: 'OCR ภาษาไทย · ฟรี', line1: 'เปลี่ยน|*รูปภาพ*', line2: 'เป็น|*ข้อความ*' }} />
        <Composition id="Upload" component={UploadScene} durationInFrames={68} fps={30} width={1080} height={1920} defaultProps={{ title: 'ลากไฟล์ หรือ|*ทั้งโฟลเดอร์*' }} />
        <Composition id="Detect" component={DetectScene} durationInFrames={83} fps={30} width={1080} height={1920} defaultProps={{ title: 'เจอทุก|*บรรทัด*|อัตโนมัติ' }} />
        <Composition id="Results" component={ResultsScene} durationInFrames={68} fps={30} width={1080} height={1920} defaultProps={{ title: 'ได้|*ข้อความ*|ทันที', subtitle: 'คัดลอก · แก้ไข · ส่งออก' }} />
        <Composition id="Box" component={BoxScene} durationInFrames={68} fps={30} width={1080} height={1920} defaultProps={{ title: 'ลาก|*กรอบ*|อ่านเฉพาะส่วน' }} />
        <Composition id="Batch" component={BatchScene} durationInFrames={83} fps={30} width={1080} height={1920} defaultProps={{ title: 'ทั้ง|*โฟลเดอร์*|ในคลิกเดียว' }} />
        <Composition id="Export" component={ExportScene} durationInFrames={68} fps={30} width={1080} height={1920} defaultProps={{ title: 'ส่งออก|*ทุกแบบ*' }} />
        <Composition id="Privacy" component={PrivacyScene} durationInFrames={68} fps={30} width={1080} height={1920} defaultProps={{ title: 'ไฟล์|*ไม่ออก*|จากเครื่อง', subtitle: 'OCR ทำงานในเบราว์เซอร์ ไม่มีการอัปโหลด' }} />
        <Composition id="CTA" component={CtaScene} durationInFrames={94} fps={30} width={1080} height={1920} defaultProps={{ brand: 'Free|Thai|*OCR*', tagline: 'OCR ภาษาไทย ฟรี ในเบราว์เซอร์', url: 'github.com/KananatSSN/FreeThaiOCR' }} />
      </Folder>
    </>
  );
};
