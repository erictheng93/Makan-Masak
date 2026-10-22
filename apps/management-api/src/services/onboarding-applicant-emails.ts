/**
 * Every email an onboarding applicant receives, in each language the
 * onboarding app offers. Plain text only: OnboardingService.sendApplicantEmail
 * HTML-escapes the whole body, so interpolated values need no escaping here.
 *
 * Platform-operator notifications are not applicant-facing and stay out.
 */

import {
  ONBOARDING_LOCALES,
  type OnboardingLocale,
} from "@makanmasak/shared-types";

export interface ApplicantEmail {
  subject: string;
  text: string;
}

interface Applicant {
  contactName: string;
  businessName: string;
}

export interface ApplicantEmails {
  received(p: Applicant & { statusLink: string }): ApplicantEmail;
  rejected(p: Applicant & { reason: string }): ApplicantEmail;
  setupPassword(
    p: Applicant & { username: string; setupLink: string; expiresAt: string },
  ): ApplicantEmail;
  /** A second submit for an email that already has an application in review. */
  alreadyPending(p: Applicant & { statusLink: string }): ApplicantEmail;
  /** The applicant asked for their status link again. */
  statusLink(p: Applicant & { statusLink: string }): ApplicantEmail;
}

const lines = (...parts: string[]) => parts.join("\n");

export const APPLICANT_EMAILS: Record<OnboardingLocale, ApplicantEmails> = {
  "zh-TW": {
    received: (p) => ({
      subject: `MakanMasak 已收到「${p.businessName}」的申請`,
      text: lines(
        `${p.contactName} 您好：`,
        "",
        `我們已收到「${p.businessName}」的申請，正在審核中。`,
        `您可隨時在此查看申請狀態：${p.statusLink}`,
      ),
    }),
    rejected: (p) => ({
      subject: `MakanMasak「${p.businessName}」申請結果`,
      text: lines(
        `${p.contactName} 您好：`,
        "",
        `很抱歉，「${p.businessName}」的申請未能通過。`,
        `原因：${p.reason}`,
      ),
    }),
    setupPassword: (p) => ({
      subject: `MakanMasak「${p.businessName}」店主帳號開通`,
      text: lines(
        `${p.contactName} 您好：`,
        "",
        `您的店家「${p.businessName}」已開通。`,
        `店主帳號：${p.username}`,
        `請在此設定密碼：${p.setupLink}`,
        `此連結將於 ${p.expiresAt} 到期。`,
      ),
    }),
    alreadyPending: (p) => ({
      subject: `MakanMasak「${p.businessName}」的申請仍在審核中`,
      text: lines(
        `${p.contactName} 您好：`,
        "",
        `有人用這個 Email 再次送出了開店申請。您已有一筆「${p.businessName}」的申請正在審核中，所以我們沒有建立新的申請。`,
        `查看申請狀態：${p.statusLink}`,
        "先前寄給您的狀態連結已失效，請改用這一個。",
        "如果不是您本人送出的，可以忽略這封信。",
      ),
    }),
    statusLink: (p) => ({
      subject: `MakanMasak「${p.businessName}」的申請狀態連結`,
      text: lines(
        `${p.contactName} 您好：`,
        "",
        `這是「${p.businessName}」申請的狀態連結：${p.statusLink}`,
        "先前寄給您的狀態連結已失效，請改用這一個。",
        "如果不是您本人要求的，可以忽略這封信。",
      ),
    }),
  },
  "zh-CN": {
    received: (p) => ({
      subject: `MakanMasak 已收到“${p.businessName}”的申请`,
      text: lines(
        `${p.contactName} 您好：`,
        "",
        `我们已收到“${p.businessName}”的申请，正在审核中。`,
        `您可随时在此查看申请状态：${p.statusLink}`,
      ),
    }),
    rejected: (p) => ({
      subject: `MakanMasak“${p.businessName}”申请结果`,
      text: lines(
        `${p.contactName} 您好：`,
        "",
        `很抱歉，“${p.businessName}”的申请未能通过。`,
        `原因：${p.reason}`,
      ),
    }),
    setupPassword: (p) => ({
      subject: `MakanMasak“${p.businessName}”店主账号已开通`,
      text: lines(
        `${p.contactName} 您好：`,
        "",
        `您的店铺“${p.businessName}”已开通。`,
        `店主账号：${p.username}`,
        `请在此设置密码：${p.setupLink}`,
        `此链接将于 ${p.expiresAt} 过期。`,
      ),
    }),
    alreadyPending: (p) => ({
      subject: `MakanMasak“${p.businessName}”的申请仍在审核中`,
      text: lines(
        `${p.contactName} 您好：`,
        "",
        `有人用这个邮箱再次提交了开店申请。您已有一份“${p.businessName}”的申请正在审核中，因此我们没有创建新的申请。`,
        `查看申请状态：${p.statusLink}`,
        "之前发给您的状态链接已失效，请改用这一个。",
        "如果不是您本人提交的，可以忽略这封邮件。",
      ),
    }),
    statusLink: (p) => ({
      subject: `MakanMasak“${p.businessName}”的申请状态链接`,
      text: lines(
        `${p.contactName} 您好：`,
        "",
        `这是“${p.businessName}”申请的状态链接：${p.statusLink}`,
        "之前发给您的状态链接已失效，请改用这一个。",
        "如果不是您本人请求的，可以忽略这封邮件。",
      ),
    }),
  },
  "en-US": {
    received: (p) => ({
      subject: `MakanMasak received the application for ${p.businessName}`,
      text: lines(
        `Hi ${p.contactName},`,
        "",
        `We have received the application for ${p.businessName} and it is under review.`,
        `You can check its status at any time here: ${p.statusLink}`,
      ),
    }),
    rejected: (p) => ({
      subject: `MakanMasak application result for ${p.businessName}`,
      text: lines(
        `Hi ${p.contactName},`,
        "",
        `We're sorry, the application for ${p.businessName} was not approved.`,
        `Reason: ${p.reason}`,
      ),
    }),
    setupPassword: (p) => ({
      subject: `Your MakanMasak owner account for ${p.businessName} is ready`,
      text: lines(
        `Hi ${p.contactName},`,
        "",
        `Your shop ${p.businessName} is now set up.`,
        `Owner username: ${p.username}`,
        `Set your password here: ${p.setupLink}`,
        `This link expires at ${p.expiresAt}.`,
      ),
    }),
    alreadyPending: (p) => ({
      subject: `Your MakanMasak application for ${p.businessName} is still under review`,
      text: lines(
        `Hi ${p.contactName},`,
        "",
        `Someone submitted a new shop application with this email. You already have an application for ${p.businessName} under review, so no new application was created.`,
        `Check its status here: ${p.statusLink}`,
        "Any status link we sent you earlier no longer works; please use this one.",
        "If this wasn't you, you can ignore this email.",
      ),
    }),
    statusLink: (p) => ({
      subject: `Your MakanMasak status link for ${p.businessName}`,
      text: lines(
        `Hi ${p.contactName},`,
        "",
        `Here is the status link for the ${p.businessName} application: ${p.statusLink}`,
        "Any status link we sent you earlier no longer works; please use this one.",
        "If you didn't ask for this, you can ignore this email.",
      ),
    }),
  },
  "vi-VN": {
    received: (p) => ({
      subject: `MakanMasak đã nhận đơn đăng ký của ${p.businessName}`,
      text: lines(
        `Xin chào ${p.contactName},`,
        "",
        `Chúng tôi đã nhận đơn đăng ký của ${p.businessName} và đang xem xét.`,
        `Bạn có thể xem trạng thái đơn bất cứ lúc nào tại: ${p.statusLink}`,
      ),
    }),
    rejected: (p) => ({
      subject: `Kết quả đơn đăng ký MakanMasak của ${p.businessName}`,
      text: lines(
        `Xin chào ${p.contactName},`,
        "",
        `Rất tiếc, đơn đăng ký của ${p.businessName} chưa được chấp thuận.`,
        `Lý do: ${p.reason}`,
      ),
    }),
    setupPassword: (p) => ({
      subject: `Tài khoản chủ cửa hàng MakanMasak của ${p.businessName} đã sẵn sàng`,
      text: lines(
        `Xin chào ${p.contactName},`,
        "",
        `Cửa hàng ${p.businessName} của bạn đã được kích hoạt.`,
        `Tên đăng nhập chủ cửa hàng: ${p.username}`,
        `Đặt mật khẩu tại đây: ${p.setupLink}`,
        `Liên kết này hết hạn lúc ${p.expiresAt}.`,
      ),
    }),
    alreadyPending: (p) => ({
      subject: `Đơn đăng ký MakanMasak của ${p.businessName} vẫn đang được xem xét`,
      text: lines(
        `Xin chào ${p.contactName},`,
        "",
        `Có người vừa gửi đơn đăng ký mở cửa hàng mới bằng email này. Bạn đã có một đơn đăng ký của ${p.businessName} đang được xem xét, nên chúng tôi không tạo đơn mới.`,
        `Xem trạng thái đơn tại: ${p.statusLink}`,
        "Liên kết trạng thái gửi cho bạn trước đây không còn dùng được; vui lòng dùng liên kết này.",
        "Nếu không phải bạn gửi, bạn có thể bỏ qua email này.",
      ),
    }),
    statusLink: (p) => ({
      subject: `Liên kết trạng thái đơn MakanMasak của ${p.businessName}`,
      text: lines(
        `Xin chào ${p.contactName},`,
        "",
        `Đây là liên kết trạng thái đơn đăng ký của ${p.businessName}: ${p.statusLink}`,
        "Liên kết trạng thái gửi cho bạn trước đây không còn dùng được; vui lòng dùng liên kết này.",
        "Nếu không phải bạn yêu cầu, bạn có thể bỏ qua email này.",
      ),
    }),
  },
  "ms-MY": {
    received: (p) => ({
      subject: `MakanMasak telah menerima permohonan untuk ${p.businessName}`,
      text: lines(
        `Hai ${p.contactName},`,
        "",
        `Kami telah menerima permohonan untuk ${p.businessName} dan ia sedang disemak.`,
        `Anda boleh menyemak statusnya pada bila-bila masa di sini: ${p.statusLink}`,
      ),
    }),
    rejected: (p) => ({
      subject: `Keputusan permohonan MakanMasak untuk ${p.businessName}`,
      text: lines(
        `Hai ${p.contactName},`,
        "",
        `Harap maaf, permohonan untuk ${p.businessName} tidak diluluskan.`,
        `Sebab: ${p.reason}`,
      ),
    }),
    setupPassword: (p) => ({
      subject: `Akaun pemilik MakanMasak untuk ${p.businessName} sudah sedia`,
      text: lines(
        `Hai ${p.contactName},`,
        "",
        `Kedai anda, ${p.businessName}, kini telah diaktifkan.`,
        `Nama pengguna pemilik: ${p.username}`,
        `Tetapkan kata laluan anda di sini: ${p.setupLink}`,
        `Pautan ini tamat tempoh pada ${p.expiresAt}.`,
      ),
    }),
    alreadyPending: (p) => ({
      subject: `Permohonan MakanMasak untuk ${p.businessName} masih disemak`,
      text: lines(
        `Hai ${p.contactName},`,
        "",
        `Seseorang telah menghantar permohonan kedai baharu dengan e-mel ini. Anda sudah mempunyai permohonan untuk ${p.businessName} yang sedang disemak, jadi tiada permohonan baharu dibuat.`,
        `Semak statusnya di sini: ${p.statusLink}`,
        "Pautan status yang kami hantar sebelum ini tidak lagi berfungsi; sila gunakan pautan ini.",
        "Jika ini bukan anda, abaikan sahaja e-mel ini.",
      ),
    }),
    statusLink: (p) => ({
      subject: `Pautan status MakanMasak untuk ${p.businessName}`,
      text: lines(
        `Hai ${p.contactName},`,
        "",
        `Ini pautan status untuk permohonan ${p.businessName}: ${p.statusLink}`,
        "Pautan status yang kami hantar sebelum ini tidak lagi berfungsi; sila gunakan pautan ini.",
        "Jika anda tidak memintanya, abaikan sahaja e-mel ini.",
      ),
    }),
  },
  "id-ID": {
    received: (p) => ({
      subject: `MakanMasak telah menerima pendaftaran untuk ${p.businessName}`,
      text: lines(
        `Halo ${p.contactName},`,
        "",
        `Kami telah menerima pendaftaran untuk ${p.businessName} dan sedang meninjaunya.`,
        `Anda dapat memeriksa statusnya kapan saja di sini: ${p.statusLink}`,
      ),
    }),
    rejected: (p) => ({
      subject: `Hasil pendaftaran MakanMasak untuk ${p.businessName}`,
      text: lines(
        `Halo ${p.contactName},`,
        "",
        `Mohon maaf, pendaftaran untuk ${p.businessName} tidak disetujui.`,
        `Alasan: ${p.reason}`,
      ),
    }),
    setupPassword: (p) => ({
      subject: `Akun pemilik MakanMasak untuk ${p.businessName} sudah siap`,
      text: lines(
        `Halo ${p.contactName},`,
        "",
        `Toko Anda, ${p.businessName}, kini sudah aktif.`,
        `Nama pengguna pemilik: ${p.username}`,
        `Atur kata sandi Anda di sini: ${p.setupLink}`,
        `Tautan ini kedaluwarsa pada ${p.expiresAt}.`,
      ),
    }),
    alreadyPending: (p) => ({
      subject: `Pendaftaran MakanMasak untuk ${p.businessName} masih ditinjau`,
      text: lines(
        `Halo ${p.contactName},`,
        "",
        `Seseorang mengirim pendaftaran toko baru dengan email ini. Anda sudah memiliki pendaftaran untuk ${p.businessName} yang sedang ditinjau, jadi tidak ada pendaftaran baru yang dibuat.`,
        `Periksa statusnya di sini: ${p.statusLink}`,
        "Tautan status yang kami kirim sebelumnya tidak berlaku lagi; silakan gunakan tautan ini.",
        "Jika ini bukan Anda, abaikan saja email ini.",
      ),
    }),
    statusLink: (p) => ({
      subject: `Tautan status MakanMasak untuk ${p.businessName}`,
      text: lines(
        `Halo ${p.contactName},`,
        "",
        `Ini tautan status untuk pendaftaran ${p.businessName}: ${p.statusLink}`,
        "Tautan status yang kami kirim sebelumnya tidak berlaku lagi; silakan gunakan tautan ini.",
        "Jika Anda tidak memintanya, abaikan saja email ini.",
      ),
    }),
  },
};

/** Rows from before the locale column have none; their emails were zh-TW. */
export function applicantEmails(locale: string | null | undefined) {
  return (ONBOARDING_LOCALES as readonly string[]).includes(locale ?? "")
    ? APPLICANT_EMAILS[locale as OnboardingLocale]
    : APPLICANT_EMAILS["zh-TW"];
}
