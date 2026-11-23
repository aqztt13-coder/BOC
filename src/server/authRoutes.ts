import { Router } from 'express';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.ts';
import {
  appreciations,
  careerEvents,
  documents,
  employees,
  leaveRequests,
  notifications,
  passwordResetOtps,
  penalties,
  trainingCourses,
  trainingEnrollments,
  transactions,
  users,
} from '../db/schema.ts';
import {
  generateOtpCode,
  hashOtp,
  hashPassword,
  maskEmail,
  signSessionToken,
  verifyOtpHash,
  verifyPassword,
  verifySessionToken,
} from '../lib/authCrypto.ts';
import { generateCode, todayISO, translateDbError, writeAuditLog } from '../db/repository.ts';
import { getPermissionsForRole } from '../utils/permissions.ts';
import { authenticateBearerToken, toSafeAuthUser, type DbAuthUser } from '../middleware/auth.ts';
import type { UserRole } from '../types/hrms.ts';

export const authRouter = Router();

authRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  next();
});

function sanitizeUser(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    uid: u.uid,
    employeeCode: u.employeeCode,
    email: u.email,
    displayName: u.displayName,
    photoUrl: u.photoUrl,
    role: u.role as UserRole,
    department: u.department,
    section: u.section || '',
    oilfield: u.oilfield,
    employeeId: u.employeeId,
    isActive: u.isActive,
    mustResetPassword: u.mustResetPassword,
    permissions: getPermissionsForRole(u.role),
    createdAt: u.createdAt.toISOString(),
  };
}

async function issueEmailOtp(
  user: typeof users.$inferSelect,
  purpose: 'FIRST_LOGIN' | 'FORGOT_PASSWORD'
) {
  const employeeCode = (user.employeeCode || `USR-${user.id}`).toUpperCase();
  const otpCode = generateOtpCode();
  const otpHash = hashOtp(otpCode, employeeCode);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await db.insert(passwordResetOtps).values({
    userId: user.id,
    employeeCode,
    email: user.email,
    otpHash,
    purpose,
    attempts: 0,
    expiresAt,
  });

  const subject =
    purpose === 'FIRST_LOGIN'
      ? 'شركة نفط البصرة — رمز تفعيل الحساب وتعيين كلمة المرور الشخصية'
      : 'شركة نفط البصرة — رمز إعادة تعيين كلمة المرور';

  const bodyAr =
    purpose === 'FIRST_LOGIN'
      ? `السيد/ة ${user.displayName} (${employeeCode})، مرحباً بكم في بوابة الموارد البشرية لشركة نفط البصرة. نظراً لدخولكم الأول بكلمة المرور الأولية، يرجى استخدام رمز التحقق التالي لتعيين كلمة مروركم الشخصية الجديدة. صلاحية الرمز 10 دقائق فقط.`
      : `السيد/ة ${user.displayName} (${employeeCode})، تم استلام طلب لإعادة تعيين كلمة المرور الخاصة بحسابكم في منصة موارد البصرة. يرجى إدخال رمز التحقق أدناه خلال 10 دقائق.`;

  return {
    maskedEmail: maskEmail(user.email),
    emailPreview: {
      to: user.email,
      from: 'hr-security@boc.oil.gov.iq',
      subject,
      bodyAr,
      otpCode,
      expiresMinutes: 10,
      sentAt: new Date().toISOString(),
    },
  };
}

// 1. Check whether an administrator has already been initialized (no sensitive counts leaked)
authRouter.get('/status', async (_req, res) => {
  try {
    const allUsers = await db
      .select({ id: users.id, role: users.role, isActive: users.isActive })
      .from(users);

    const hasAnyAdmin = allUsers.some(
      (u) => u.isActive && (u.role === 'HR_ADMIN' || u.role === 'HR_MANAGER')
    );

    res.json({
      initialized: hasAnyAdmin,
    });
  } catch (error) {
    const mapped = translateDbError(error, 'تعذر التحقق من حالة تهيئة النظام.');
    res.status(mapped.status).json({ error: mapped.message });
  }
});

// 2. One-Time First-Run HR Admin Setup (strictly locked once ANY HR_ADMIN exists, unless caller is an authenticated HR_ADMIN)
authRouter.post('/bootstrap-workspace', async (req, res) => {
  const schema = z.object({
    hrEmployeeCode: z.string().trim().min(3).max(40).default('BOC-1000'),
    hrFullName: z.string().trim().min(3).max(140).default('حيدر عبدالكريم الربيعي'),
    hrEmail: z.string().trim().email().default('hr.director@boc.oil.gov.iq'),
    hrPassword: z.string().min(8).max(128),
    employeeInitialPassword: z.string().min(8).max(128).optional(),
    includeSampleBocData: z.boolean().default(true),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'يرجى إدخال بيانات صالحة وكلمة مرور لا تقل عن 8 أحرف.',
    });
  }

  const d = parsed.data;
  const hrCode = d.hrEmployeeCode.toUpperCase();
  const empTempPass = d.employeeInitialPassword || d.hrPassword;

  try {
    // Strict anti-takeover check: if ANY active HR_ADMIN already exists, require verified HR_ADMIN Bearer auth
    const existingUsers = await db.select().from(users);
    const hasExistingAdmin = existingUsers.some(
      (u) => u.isActive && (u.role === 'HR_ADMIN' || u.role === 'HR_MANAGER')
    );
    if (hasExistingAdmin) {
      const authHeader = req.headers.authorization;
      const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
      if (!bearer) {
        return res.status(403).json({
          error: 'تمت تهيئة مدير النظام مسبقاً. لا يمكن إنشاء حساب إداري بدون مصادقة مدير النظام.',
        });
      }
      const authResult = await authenticateBearerToken(bearer);
      if (!authResult.ok || authResult.dbUser.role !== 'HR_ADMIN') {
        return res.status(403).json({
          error: 'يتطلب هذا الإجراء صلاحية مدير النظام (HR_ADMIN) المصادق عليه.',
        });
      }
    }

    const today = todayISO();
    let createdHrUser: typeof users.$inferSelect | null = null;
    let firstLoginDemoCode: string | null = null;

    await db.transaction(async (tx) => {
      // Create HR Director employee record if not present
      let [hrEmp] = await tx
        .select()
        .from(employees)
        .where(eq(employees.employeeCode, hrCode))
        .limit(1);

      if (!hrEmp) {
        [hrEmp] = await tx
          .insert(employees)
          .values({
            employeeCode: hrCode,
            nationalId: '198004128812',
            fullName: d.hrFullName,
            fullNameEn: 'Haider Abdulkarim Al-Rubaie',
            birthDate: '1980-04-12',
            gender: 'ذكر',
            jobTitle: 'مدير قسم الموارد البشرية',
            jobTitleEn: 'HR Department Manager',
            department: 'قسم الموارد البشرية',
            oilfield: 'المقر العام - البصرة',
            section: 'شعبة الملاك والترفيعات',
            grade: 2,
            step: 4,
            hireDate: '2006-03-15',
            lastPromotionDate: '2022-03-15',
            lastIncrementDate: '2025-12-01',
            academicDegree: 'ماجستير',
            specialization: 'إدارة الأعمال والموارد البشرية',
            email: d.hrEmail.toLowerCase(),
            phone: '07801122334',
            basicSalaryIQD: 1450000,
            annualLeaveBalance: 26,
            sickLeaveBalance: 30,
            status: 'نشط',
            notes: 'مدير قسم الموارد البشرية — حساب إداري رئيسي',
          })
          .returning();
      }

      // Create or update HR Admin user account with scrypt password hash
      const existingByEmail = existingUsers.find((u) => u.email.toLowerCase() === d.hrEmail.toLowerCase());
      if (existingByEmail) {
        const [updated] = await tx
          .update(users)
          .set({
            employeeCode: hrCode,
            displayName: d.hrFullName,
            passwordHash: hashPassword(d.hrPassword),
            mustResetPassword: false,
            role: 'HR_ADMIN',
            department: 'قسم الموارد البشرية',
            oilfield: 'المقر العام - البصرة',
            employeeId: hrEmp.id,
            isActive: true,
            updatedAt: new Date(),
          })
          .where(eq(users.id, existingByEmail.id))
          .returning();
        createdHrUser = updated;
      } else {
        const [inserted] = await tx
          .insert(users)
          .values({
            uid: `boc-emp-${hrCode.toLowerCase()}`,
            employeeCode: hrCode,
            email: d.hrEmail.toLowerCase(),
            displayName: d.hrFullName,
            passwordHash: hashPassword(d.hrPassword),
            mustResetPassword: false,
            role: 'HR_ADMIN',
            department: 'قسم الموارد البشرية',
            oilfield: 'المقر العام - البصرة',
            employeeId: hrEmp.id,
            isActive: true,
          })
          .returning();
        createdHrUser = inserted;
      }

      // Optionally seed realistic Arabic Basra Oil Company dataset (Rumaila, Zubair, Majnoon, West Qurna)
      if (d.includeSampleBocData) {
        const sampleStaff = [
          {
            employeeCode: 'BOC-2041',
            nationalId: '198908145521',
            fullName: 'كرار حسين جاسم التميمي',
            fullNameEn: 'Karrar Hussein Jassim Al-Tamimi',
            birthDate: '1989-08-14',
            jobTitle: 'مهندس مكامن أقدم',
            jobTitleEn: 'Senior Reservoir Engineer',
            department: 'هيئة تشغيل الرميلة',
            oilfield: 'حقل الرميلة الشمالي',
            section: 'شعبة هندسة المكامن',
            grade: 5,
            step: 3,
            hireDate: '2014-05-10',
            lastPromotionDate: '2021-12-01',
            lastIncrementDate: '2025-12-05',
            academicDegree: 'ماجستير',
            specialization: 'هندسة النفط والمكامن',
            email: 'karrar.tamimi@boc.oil.gov.iq',
            phone: '07714528890',
            basicSalaryIQD: 985000,
            annualLeaveBalance: 22,
            sickLeaveBalance: 28,
            status: 'نشط',
            notes: 'مهندس متميز في مراقبة ضغوط المكامن — مرشح للترفيع القادم.',
            mustResetPassword: true, // Demonstrates first-time login email OTP flow!
            accountRole: 'EMPLOYEE' as UserRole,
          },
          {
            employeeCode: 'BOC-2088',
            nationalId: '199103229104',
            fullName: 'زينب علي كاظم الموسوي',
            fullNameEn: 'Zainab Ali Kadhim Al-Mousawi',
            birthDate: '1991-03-22',
            jobTitle: 'مهندس سلامة مهنية وبيئة',
            jobTitleEn: 'HSE Engineer',
            department: 'قسم الصحة والسلامة والبيئة HSE',
            oilfield: 'حقل الزبير',
            section: 'شعبة السلامة المهنية',
            grade: 6,
            step: 4,
            hireDate: '2016-09-01',
            lastPromotionDate: '2022-12-10',
            lastIncrementDate: '2025-12-15',
            academicDegree: 'بكالوريوس',
            specialization: 'الهندسة الكيمياوية',
            email: 'zainab.mousawi@boc.oil.gov.iq',
            phone: '07819944120',
            basicSalaryIQD: 840000,
            annualLeaveBalance: 27,
            sickLeaveBalance: 30,
            status: 'نشط',
            notes: 'منسقة معايير السلامة الميدانية في محطة عزل الغاز بالزبير.',
            mustResetPassword: false,
            accountRole: 'EMPLOYEE' as UserRole,
          },
          {
            employeeCode: 'BOC-3105',
            nationalId: '198411053318',
            fullName: 'مرتضى فالح حسن البصري',
            fullNameEn: 'Murtadha Faleh Hassan Al-Basri',
            birthDate: '1984-11-05',
            jobTitle: 'مهندس حفر آبار',
            jobTitleEn: 'Drilling Engineer',
            department: 'هيئة تشغيل مجنون',
            oilfield: 'حقل مجنون',
            section: 'شعبة الحفر',
            grade: 4,
            step: 2,
            hireDate: '2010-02-20',
            lastPromotionDate: '2022-01-15',
            lastIncrementDate: '2025-11-01',
            academicDegree: 'بكالوريوس',
            specialization: 'هندسة الحفر والإنتاج',
            email: 'murtadha.basri@boc.oil.gov.iq',
            phone: '07703319945',
            basicSalaryIQD: 1120000,
            annualLeaveBalance: 19,
            sickLeaveBalance: 25,
            status: 'نشط',
            notes: 'مشرف عمليات الحفر العميق في حقل مجنون.',
            mustResetPassword: false,
            accountRole: 'DEPT_MANAGER' as UserRole,
          },
          {
            employeeCode: 'BOC-3412',
            nationalId: '196705184402',
            fullName: 'عبدالرزاق جبار سلمان العبودي',
            fullNameEn: 'Abdulrazzaq Jabbar Salman Al-Aboudi',
            birthDate: '1967-05-18',
            jobTitle: 'رئيس مهندسين أقدم',
            jobTitleEn: 'Chief Senior Engineer',
            department: 'هيئة تشغيل غرب القرنة',
            oilfield: 'حقل غرب القرنة 1',
            section: 'شعبة الإنتاج وعزل الغاز',
            grade: 3,
            step: 5,
            hireDate: '1996-07-01',
            lastPromotionDate: '2021-11-20',
            lastIncrementDate: '2025-11-28',
            academicDegree: 'بكالوريوس',
            specialization: 'هندسة ميكانيك القوى',
            email: 'abdulrazzaq.aboudi@boc.oil.gov.iq',
            phone: '07806612240',
            basicSalaryIQD: 1340000,
            annualLeaveBalance: 34,
            sickLeaveBalance: 30,
            status: 'نشط',
            notes: 'خبير محطات الإنتاج — يقترب من السن القانوني للتقاعد.',
            mustResetPassword: false,
            accountRole: 'EMPLOYEE' as UserRole,
          },
          {
            employeeCode: 'BOC-3590',
            nationalId: '199306102219',
            fullName: 'مصطفى صادق جعفر السعدون',
            fullNameEn: 'Mustafa Sadiq Jaafar Al-Saadoun',
            birthDate: '1993-06-10',
            jobTitle: 'مهندس سيطرة وآلات دقيقة',
            jobTitleEn: 'Instrumentation & SCADA Engineer',
            department: 'قسم تقنية المعلومات والاتصالات',
            oilfield: 'حقل الرميلة الجنوبي',
            section: 'شعبة السيطرة والآلات الدقيقة SCADA',
            grade: 7,
            step: 3,
            hireDate: '2019-04-01',
            lastPromotionDate: '2023-04-01',
            lastIncrementDate: '2026-04-01',
            academicDegree: 'بكالوريوس',
            specialization: 'هندسة السيطرة والنظم',
            email: 'mustafa.saadoun@boc.oil.gov.iq',
            phone: '07728841102',
            basicSalaryIQD: 760000,
            annualLeaveBalance: 24,
            sickLeaveBalance: 29,
            status: 'نشط',
            notes: 'مسؤول صيانة منظومات SCADA لمحطات الرميلة الجنوبية.',
            mustResetPassword: false,
            accountRole: 'EMPLOYEE' as UserRole,
          },
        ];

        const insertedEmps: (typeof employees.$inferSelect)[] = [];
        for (const s of sampleStaff) {
          const [empRow] = await tx
            .insert(employees)
            .values({
              employeeCode: s.employeeCode,
              nationalId: s.nationalId,
              fullName: s.fullName,
              fullNameEn: s.fullNameEn,
              birthDate: s.birthDate,
              jobTitle: s.jobTitle,
              jobTitleEn: s.jobTitleEn,
              department: s.department,
              oilfield: s.oilfield,
              section: s.section,
              grade: s.grade,
              step: s.step,
              hireDate: s.hireDate,
              lastPromotionDate: s.lastPromotionDate,
              lastIncrementDate: s.lastIncrementDate,
              academicDegree: s.academicDegree,
              specialization: s.specialization,
              email: s.email,
              phone: s.phone,
              basicSalaryIQD: s.basicSalaryIQD,
              annualLeaveBalance: s.annualLeaveBalance,
              sickLeaveBalance: s.sickLeaveBalance,
              status: s.status,
              notes: s.notes,
            })
            .onConflictDoNothing({ target: employees.employeeCode })
            .returning();

          if (empRow) {
            insertedEmps.push(empRow);
            await tx.insert(users).values({
              uid: `boc-emp-${s.employeeCode.toLowerCase()}`,
              employeeCode: s.employeeCode,
              email: s.email,
              displayName: s.fullName,
              passwordHash: hashPassword(empTempPass),
              mustResetPassword: s.mustResetPassword,
              role: s.accountRole,
              department: s.department,
              oilfield: s.oilfield,
              employeeId: empRow.id,
              isActive: true,
            }).onConflictDoNothing();

            await tx.insert(careerEvents).values({
              employeeId: empRow.id,
              eventType: 'تعيين',
              title: 'مباشرة الخدمة الوظيفية على الملاك الدائم',
              description: `${empRow.jobTitle} — ${empRow.department} (${empRow.oilfield})`,
              eventDate: empRow.hireDate,
              referenceNumber: empRow.employeeCode,
              createdBy: d.hrFullName,
            });
          }
        }

        const karrar = insertedEmps.find((e) => e.employeeCode === 'BOC-2041');
        const zainab = insertedEmps.find((e) => e.employeeCode === 'BOC-2088');
        const murtadha = insertedEmps.find((e) => e.employeeCode === 'BOC-3105');

        firstLoginDemoCode = karrar ? 'BOC-2041' : null;

        if (karrar && zainab && murtadha) {
          // Appreciation letters & 1 penalty to demonstrate Seniority / Delay engine
          await tx.insert(appreciations).values([
            {
              employeeId: karrar.id,
              letterNumber: 'ش-ت/2026/142',
              issueDate: '2026-02-18',
              issuingAuthority: 'السيد وزير النفط المحترم',
              subject: 'الجهود الاستثنائية في رفع الطاقة الإنتاجية لآبار الرميلة الشمالي',
              seniorityMonths: 1,
              verificationCode: generateCode('BOC-APP'),
              appliedToCurrentCycle: true,
              createdBy: d.hrFullName,
            },
            {
              employeeId: karrar.id,
              letterNumber: 'ش-ت/2026/308',
              issueDate: '2026-07-05',
              issuingAuthority: 'السيد مدير عام شركة نفط البصرة',
              subject: 'إنجاز مشروع النمذجة المكمنية قبل الموعد المقرر دون كلف إضافية',
              seniorityMonths: 1,
              verificationCode: generateCode('BOC-APP'),
              appliedToCurrentCycle: true,
              createdBy: d.hrFullName,
            },
            {
              employeeId: zainab.id,
              letterNumber: 'ش-ت/2026/219',
              issueDate: '2026-05-11',
              issuingAuthority: 'السيد مدير عام شركة نفط البصرة',
              subject: 'تحقيق صفر حوادث عمل خلال حملة الصيانة المبرمجة في حقل الزبير',
              seniorityMonths: 1,
              verificationCode: generateCode('BOC-APP'),
              appliedToCurrentCycle: true,
              createdBy: d.hrFullName,
            },
          ]).onConflictDoNothing();

          await tx.insert(penalties).values({
            employeeId: murtadha.id,
            orderNumber: 'ع-إ/2026/44',
            issueDate: '2026-04-02',
            penaltyType: 'لفت نظر',
            delayMonths: 3,
            reason: 'تأخر رفع تقرير السلامة اليومي لمنصة الحفر رقم 14',
            appliedToCurrentCycle: true,
            createdBy: d.hrFullName,
          }).onConflictDoNothing();

          // Training Courses
          const [course1, course2, course3] = await tx
            .insert(trainingCourses)
            .values([
              {
                code: 'TRN-HSE-2026',
                title: 'معايير السلامة المهنية المتقدمة وإدارة المخاطر النفطية (NEBOSH / HSE)',
                titleEn: 'Advanced Oilfield HSE & Risk Management',
                category: 'السلامة المهنية HSE',
                deliveryType: 'داخلي',
                provider: 'مركز التدريب والتطوير النفطي — البصرة',
                instructor: 'د. عادل محسن الخفاجي',
                startDate: '2026-12-05',
                endDate: '2026-12-12',
                location: 'مركز تدريب شركة نفط البصرة — المكينة',
                totalSeats: 25,
                budgetIQD: 4500000,
                trainingPlanYear: 2026,
                status: 'مفتوح للتسجيل',
              },
              {
                code: 'TRN-RES-410',
                title: 'النمذجة الرقمية المتقدمة للمكامن النفطية (Petrel & Eclipse)',
                titleEn: 'Advanced Digital Reservoir Modeling',
                category: 'هندسة النفط والمكامن',
                deliveryType: 'خارجي',
                provider: 'معهد تطوير الكوادر النفطية — بغداد',
                instructor: 'م. صلاح مهدي العزاوي',
                startDate: '2026-12-18',
                endDate: '2026-12-26',
                location: 'معهد التدريب النفطي — بغداد',
                totalSeats: 15,
                budgetIQD: 12000000,
                trainingPlanYear: 2026,
                status: 'مفتوح للتسجيل',
              },
              {
                code: 'TRN-SCADA-108',
                title: 'الأمن السيبراني لأنظمة السيطرة الصناعية SCADA في الحقول النفطية',
                titleEn: 'SCADA & Industrial Control Cybersecurity',
                category: 'السيطرة والأنظمة الرقمية',
                deliveryType: 'إلكتروني',
                provider: 'أكاديمية الطاقة الرقمية الدولية',
                instructor: 'م. نسرين طارق الوائلي',
                startDate: '2026-10-01',
                endDate: '2026-10-10',
                location: 'عن بُعد (منصة التدريب الإلكتروني)',
                totalSeats: 40,
                budgetIQD: 2500000,
                trainingPlanYear: 2026,
                status: 'مكتمل',
              },
            ])
            .onConflictDoNothing()
            .returning();

          if (course1 && course3) {
            const [certDoc] = await tx
              .insert(documents)
              .values({
                documentNumber: 'CERT-2026-881',
                title: `شهادة إتمام دورة تدريبية: ${course3.title}`,
                category: 'شهادة دورة تدريبية',
                issueDate: '2026-10-12',
                issuingAuthority: course3.provider,
                employeeId: karrar.id,
                department: karrar.department,
                oilfield: karrar.oilfield,
                description: 'إنجاز الدورة بتقدير امتياز (96%) ونسبة حضور 100%',
                fileName: 'CERT-2026-881.pdf',
                mimeType: 'application/pdf',
                fileSize: 'شهادة رسمية إلكترونية',
                verificationCode: generateCode('BOC-TRN'),
                uploadedBy: d.hrFullName,
              })
              .returning();

            await tx.insert(trainingEnrollments).values({
              courseId: course3.id,
              employeeId: karrar.id,
              appliedDate: '2026-09-20',
              status: 'مكتمل',
              attendancePercent: 100,
              evaluationScore: 96,
              evaluationNotes: 'أداء متميز ومشاركة فعالة في التمارين التطبيقية.',
              certificateDocumentId: certDoc.id,
            });
          }

          // Sample Pending Leave Transaction & Approved Service Continuation Document
          const [leaveTxn] = await tx
            .insert(transactions)
            .values({
              transactionNumber: generateCode('LV'),
              transactionType: 'LEAVE',
              title: `طلب إجازة اعتيادية (5 أيام) — ${karrar.fullName}`,
              employeeId: karrar.id,
              department: karrar.department,
              oilfield: karrar.oilfield,
              currentResponsibleRole: 'HR_MANAGER',
              status: 'بانتظار موافقة الموارد البشرية',
              payload: {
                leaveType: 'إجازة اعتيادية',
                startDate: '2026-12-01',
                endDate: '2026-12-05',
                days: 5,
                reason: 'ظروف عائلية ومراجعة رسمية',
              },
              history: [
                {
                  timestamp: new Date().toISOString(),
                  actorName: karrar.fullName,
                  actorRole: 'EMPLOYEE',
                  action: 'تقديم طلب إجازة اعتيادية',
                  fromStatus: 'مسودة',
                  toStatus: 'بانتظار موافقة القسم',
                },
                {
                  timestamp: new Date().toISOString(),
                  actorName: 'مدير هيئة تشغيل الرميلة',
                  actorRole: 'DEPT_MANAGER',
                  action: 'موافقة القسم وإحالة للموارد البشرية',
                  fromStatus: 'بانتظار موافقة القسم',
                  toStatus: 'بانتظار موافقة الموارد البشرية',
                },
              ],
              createdByUid: `boc-emp-${karrar.employeeCode.toLowerCase()}`,
            })
            .returning();

          await tx.insert(leaveRequests).values({
            employeeId: karrar.id,
            transactionId: leaveTxn.id,
            leaveType: 'إجازة اعتيادية',
            startDate: '2026-12-01',
            endDate: '2026-12-05',
            days: 5,
            reason: 'ظروف عائلية ومراجعة رسمية',
            status: 'بانتظار موافقة الموارد البشرية',
          });

          await tx.insert(transactions).values({
            transactionNumber: generateCode('TXN'),
            transactionType: 'CONTINUATION_OF_SERVICE',
            title: 'تأييد استمرار بالخدمة موجه إلى مصرف الرشيد — فرع البصرة',
            employeeId: karrar.id,
            department: karrar.department,
            oilfield: karrar.oilfield,
            currentResponsibleRole: 'HR_ADMIN',
            status: 'معتمد',
            completedAt: new Date(),
            payload: { notes: 'لأغراض السلفة السكنية' },
            history: [
              {
                timestamp: new Date().toISOString(),
                actorName: karrar.fullName,
                actorRole: 'EMPLOYEE',
                action: 'تقديم طلب تأييد استمرار بالخدمة',
                fromStatus: 'مسودة',
                toStatus: 'بانتظار موافقة الموارد البشرية',
              },
              {
                timestamp: new Date().toISOString(),
                actorName: d.hrFullName,
                actorRole: 'HR_ADMIN',
                action: 'اعتماد نهائي من الموارد البشرية',
                fromStatus: 'بانتظار موافقة الموارد البشرية',
                toStatus: 'معتمد',
              },
            ],
            createdByUid: `boc-emp-${karrar.employeeCode.toLowerCase()}`,
          });

          await tx.insert(documents).values({
            documentNumber: 'BOC-ORD-2021-904',
            title: 'أمر إداري بالترفيع إلى الدرجة الخامسة',
            category: 'أمر إداري',
            issueDate: '2021-12-01',
            issuingAuthority: 'قسم الموارد البشرية — شركة نفط البصرة',
            employeeId: karrar.id,
            department: karrar.department,
            oilfield: karrar.oilfield,
            description: 'أمر ترفيع رسمي محفوظ في الأرشيف الرقمي',
            fileName: 'BOC-ORD-2021-904.pdf',
            mimeType: 'application/pdf',
            fileSize: 'رسمي إلكتروني',
            verificationCode: generateCode('DOC-QR'),
            uploadedBy: d.hrFullName,
          }).onConflictDoNothing();

          await tx.insert(notifications).values({
            recipientRole: 'HR_ADMIN',
            title: 'استحقاق ترفيع وعلاوة قادم',
            message: `يوجد طلب إجازة معلق ومعاملات استحقاق قريبة للمراجعة في ${today}`,
            severity: 'warning',
            entityType: 'TRANSACTION',
            entityId: leaveTxn.id,
          });
        }
      }
      if (createdHrUser) {
        await writeAuditLog(
          {
            actor: toSafeAuthUser(createdHrUser),
            operation: 'INITIALIZE_WORKSPACE',
            recordType: 'SYSTEM',
            recordId: createdHrUser.id,
            details: `تهيئة النظام وإعداد حساب مدير الموارد البشرية (${createdHrUser.employeeCode})${
              d.includeSampleBocData ? ' مع بيانات حقول شركة نفط البصرة' : ''
            }`,
          },
          tx
        );
      }
    });

    if (!createdHrUser) {
      return res.status(500).json({ error: 'تعذر إنشاء حساب المدير.' });
    }
    const finalHr = createdHrUser as typeof users.$inferSelect;
    const token = signSessionToken({
      sub: finalHr.id,
      uid: finalHr.uid,
      role: finalHr.role,
      tv: finalHr.tokenVersion,
    });

    res.status(201).json({
      token,
      user: sanitizeUser(finalHr),
      firstLoginDemoCode,
    });
  } catch (error) {
    const mapped = translateDbError(error, 'فشلت تهيئة النظام.');
    res.status(mapped.status).json({ error: mapped.message });
  }
});

// 3. Employee ID + Password Login (Enforces First-Time Email OTP Password Reset)
authRouter.post('/login', async (req, res) => {
  const schema = z.object({
    employeeCode: z.string().trim().min(2).max(40),
    password: z.string().min(1).max(128),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'يرجى إدخال الرقم الوظيفي وكلمة المرور بشكل صحيح.' });
  }

  const code = parsed.data.employeeCode.toUpperCase();
  try {
    let [user] = await db.select().from(users).where(eq(users.employeeCode, code)).limit(1);

    // Fallback lookup through linked employees table by employeeCode
    if (!user) {
      const [emp] = await db
        .select()
        .from(employees)
        .where(and(eq(employees.employeeCode, code), isNull(employees.deletedAt)))
        .limit(1);
      if (emp) {
        const [linkedUser] = await db.select().from(users).where(eq(users.employeeId, emp.id)).limit(1);
        user = linkedUser;
      }
    }

    if (!user || !user.passwordHash || !verifyPassword(parsed.data.password, user.passwordHash)) {
      return res.status(401).json({ error: 'الرقم الوظيفي أو كلمة المرور غير صحيحة.' });
    }

    if (!user.isActive) {
      return res.status(403).json({ error: 'تم تعطيل هذا الحساب من قبل إدارة الموارد البشرية.' });
    }

    // Mandatory First-Time Login Email Verification & Password Reset Flow
    if (user.mustResetPassword) {
      const otpDispatch = await issueEmailOtp(user, 'FIRST_LOGIN');
      await writeAuditLog({
        actor: user as DbAuthUser,
        operation: 'FIRST_LOGIN_OTP_SENT',
        recordType: 'AUTH',
        recordId: user.id,
        details: `دخول أول بكلمة مرور أولية للرقم الوظيفي ${code} — تم إرسال رمز تحقق إلى ${otpDispatch.maskedEmail}`,
      });
      return res.status(200).json({
        requiresPasswordReset: true,
        purpose: 'FIRST_LOGIN',
        employeeCode: code,
        displayName: user.displayName,
        maskedEmail: otpDispatch.maskedEmail,
        emailPreview: otpDispatch.emailPreview,
      });
    }

    const token = signSessionToken({
      sub: user.id,
      uid: user.uid,
      role: user.role,
      tv: user.tokenVersion,
    });

    await writeAuditLog({
      actor: user as DbAuthUser,
      operation: 'LOGIN',
      recordType: 'AUTH',
      recordId: user.id,
      details: `تسجيل دخول ناجح بالرقم الوظيفي (${code}) — الدور: ${user.role}`,
    });

    res.json({
      requiresPasswordReset: false,
      token,
      user: sanitizeUser(user),
    });
  } catch (error) {
    const mapped = translateDbError(error, 'تعذر إتمام تسجيل الدخول.');
    res.status(mapped.status).json({ error: mapped.message });
  }
});

// 4. Forgot Password via Employee ID -> Registered Email OTP
authRouter.post('/forgot-password', async (req, res) => {
  const schema = z.object({
    employeeCode: z.string().trim().min(2).max(40),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'يرجى إدخال الرقم الوظيفي.' });
  }

  const code = parsed.data.employeeCode.toUpperCase();
  try {
    const [user] = await db.select().from(users).where(eq(users.employeeCode, code)).limit(1);
    if (!user || !user.isActive) {
      return res.status(404).json({
        error: 'لم يتم العثور على حساب نشط مطابق لهذا الرقم الوظيفي. يرجى مراجعة قسم الموارد البشرية.',
      });
    }

    const otpDispatch = await issueEmailOtp(user, 'FORGOT_PASSWORD');
    await writeAuditLog({
      actor: user as DbAuthUser,
      operation: 'FORGOT_PASSWORD_OTP_SENT',
      recordType: 'AUTH',
      recordId: user.id,
      details: `طلب إعادة تعيين كلمة المرور للرقم الوظيفي ${code} عبر البريد ${otpDispatch.maskedEmail}`,
    });

    res.json({
      ok: true,
      employeeCode: code,
      displayName: user.displayName,
      maskedEmail: otpDispatch.maskedEmail,
      emailPreview: otpDispatch.emailPreview,
    });
  } catch (error) {
    const mapped = translateDbError(error, 'تعذر إرسال رمز التحقق إلى البريد الإلكتروني.');
    res.status(mapped.status).json({ error: mapped.message });
  }
});

// 5. Verify Email OTP & Set New Personal Password
authRouter.post('/reset-password', async (req, res) => {
  const schema = z.object({
    employeeCode: z.string().trim().min(2).max(40),
    otpCode: z.string().trim().regex(/^\d{6}$/, 'رمز التحقق يجب أن يتكون من 6 أرقام.'),
    newPassword: z
      .string()
      .min(8, 'كلمة المرور الجديدة يجب أن لا تقل عن 8 أحرف.')
      .max(128)
      .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), {
        message: 'يجب أن تحتوي كلمة المرور على أحرف وأرقام معاً لتعزيز الأمان.',
      }),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'بيانات إعادة التعيين غير صالحة.' });
  }

  const code = parsed.data.employeeCode.toUpperCase();
  try {
    const updatedUser = await db.transaction(async (tx) => {
      const [lockedUser] = await tx
        .select()
        .from(users)
        .where(eq(users.employeeCode, code))
        .for('update')
        .limit(1);

      if (!lockedUser || !lockedUser.isActive) {
        throw Object.assign(new Error('الحساب غير موجود أو معطل.'), { status: 404 });
      }

      const [latestOtp] = await tx
        .select()
        .from(passwordResetOtps)
        .where(and(eq(passwordResetOtps.userId, lockedUser.id), isNull(passwordResetOtps.usedAt)))
        .orderBy(desc(passwordResetOtps.createdAt))
        .for('update')
        .limit(1);

      if (!latestOtp) {
        throw Object.assign(new Error('لا يوجد رمز تحقق صالح. يرجى طلب رمز جديد.'), { status: 400 });
      }
      if (latestOtp.expiresAt.getTime() < Date.now()) {
        throw Object.assign(new Error('انتهت صلاحية رمز التحقق (10 دقائق). يرجى طلب رمز جديد.'), { status: 400 });
      }
      if (latestOtp.attempts >= 5) {
        throw Object.assign(new Error('تم تجاوز الحد المسموح به للمحاولات. يرجى طلب رمز تحقق جديد.'), { status: 429 });
      }

      if (!verifyOtpHash(parsed.data.otpCode, code, latestOtp.otpHash)) {
        await tx
          .update(passwordResetOtps)
          .set({ attempts: latestOtp.attempts + 1 })
          .where(eq(passwordResetOtps.id, latestOtp.id));
        throw Object.assign(
          new Error('رمز التحقق غير صحيح. يرجى مراجعة البريد الإلكتروني والمحاولة مجدداً.'),
          { status: 400 }
        );
      }

      const nextVersion = (lockedUser.tokenVersion || 1) + 1;
      await tx
        .update(passwordResetOtps)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetOtps.id, latestOtp.id));

      const [savedUser] = await tx
        .update(users)
        .set({
          passwordHash: hashPassword(parsed.data.newPassword),
          mustResetPassword: false,
          tokenVersion: nextVersion,
          updatedAt: new Date(),
        })
        .where(eq(users.id, lockedUser.id))
        .returning();

      await writeAuditLog(
        {
          actor: toSafeAuthUser(savedUser),
          operation: 'PASSWORD_RESET_COMPLETED',
          recordType: 'AUTH',
          recordId: savedUser.id,
          details: `تعيين كلمة مرور شخصية جديدة بنجاح بعد التحقق بالبريد الإلكتروني للرقم الوظيفي (${code})`,
        },
        tx
      );

      return savedUser;
    });

    const token = signSessionToken({
      sub: updatedUser.id,
      uid: updatedUser.uid,
      role: updatedUser.role,
      tv: updatedUser.tokenVersion,
    });

    res.json({
      ok: true,
      token,
      user: sanitizeUser(updatedUser),
    });
  } catch (error) {
    const mapped = translateDbError(error, 'فشل تحديث كلمة المرور.');
    res.status(mapped.status).json({ error: mapped.message });
  }
});

// 6. Logout (Invalidates Server-Side Session Version)
authRouter.post('/logout', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer boc1.')) {
    const token = authHeader.slice('Bearer '.length).trim();
    const payload = verifySessionToken(token);
    if (payload) {
      try {
        await db
          .update(users)
          .set({ tokenVersion: payload.tv + 1, updatedAt: new Date() })
          .where(eq(users.id, payload.sub));
      } catch {
        // best-effort invalidation
      }
    }
  }
  res.json({ ok: true });
});
