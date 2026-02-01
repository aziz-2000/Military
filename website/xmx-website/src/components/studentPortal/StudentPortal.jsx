import { useState } from 'react';
import './StudentPortal.css';
import logo from "../../assets/logo.JPG";
export default function StudentPortal() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const validEmail = 'madhhar@gmail.com';
  const validPassword = '12345678';

  const handleLogin = (e) => {
    e.preventDefault();
    setError('');

    if (email === validEmail && password === validPassword) {
      setIsLoggedIn(true);
      setEmail('');
      setPassword('');
    } else {
      setError('بيانات الدخول غير صحيحة. الرجاء المحاولة مرة أخرى.');
    }
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setEmail('');
    setPassword('');
  };

  if (!isLoggedIn) {
    return <LoginPage onLogin={handleLogin} email={email} setEmail={setEmail} password={password} setPassword={setPassword} error={error} />;
  }

  return <PortalDashboard onLogout={handleLogout} />;
}

function LoginPage({ onLogin, email, setEmail, password, setPassword, error }) {
  return (
    <div className="login-container">
      <div className="login-wrapper">
        {/* Collage Image Section */}
        <div className="login-image-section">
          <img 
            src={logo}
            alt="Military College" 
            className="login-image"
          />
          <div className="image-overlay">
            <h1>كلية السلطان قابوس العسكرية </h1>
            <p>بوابة الضباط المرشحين</p>
          </div>
        </div>

        {/* Login Form Section */}
        <div className="login-form-section">
          <div className="login-card">
            <h2>تسجيل الدخول</h2>
            <p className="login-subtitle">أدخل بيانات دخولك</p>

            <form onSubmit={onLogin} className="login-form">
              <div className="form-group">
                <label htmlFor="email">البريد الإلكتروني</label>
                <input
                  type="email"
                  id="email"
                  placeholder="example@gmail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="password">كلمة المرور</label>
                <input
                  type="password"
                  id="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              {error && <div className="error-message">{error}</div>}

              <button type="submit" className="login-btn">
                دخول
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function PortalDashboard({ onLogout }) {
  const [activeSection, setActiveSection] = useState('home');

  const menuItems = [
    { id: 'home', label: 'الرئيسية', icon: '🏠' },
    { id: 'personal', label: 'البيانات الشخصية', icon: '👤' },
    { id: 'grades', label: 'الدرجات والنتائج', icon: '📊' },
    { id: 'courses', label: 'المواد والجدول', icon: '📚' },
    { id: 'advisor', label: 'المرشد الأكاديمي', icon: '👨‍🏫' },
    { id: 'reports', label: 'التقارير', icon: '📄' },
    { id: 'complaints', label: 'البلاغات والطلبات', icon: '📝' },
    { id: 'moodle', label: 'نظام التعليم الإلكتروني', icon: '💻' },
  ];

  return (
    <div className="portal-container">
      {/* Header */}
      <header className="portal-header">
        <div className="header-content">
          <h1>بوابة الضابط المرشح</h1>
          <button onClick={onLogout} className="logout-btn">
            تسجيل الخروج
          </button>
        </div>
      </header>

      <div className="portal-layout">
        {/* Sidebar */}
        <aside className="portal-sidebar">
          <nav className="portal-nav">
            {menuItems.map((item) => (
              <button
                key={item.id}
                className={`nav-item ${activeSection === item.id ? 'active' : ''}`}
                onClick={() => setActiveSection(item.id)}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="portal-content">
          {activeSection === 'home' && <HomeSection />}
          {activeSection === 'personal' && <PersonalDataSection />}
          {activeSection === 'grades' && <GradesSection />}
          {activeSection === 'courses' && <CoursesSection />}
          {activeSection === 'advisor' && <AdvisorSection />}
          {activeSection === 'reports' && <ReportsSection />}
          {activeSection === 'complaints' && <ComplaintsSection />}
          {activeSection === 'moodle' && <MoodleSection />}
        </main>
      </div>
    </div>
  );
}

function HomeSection() {
  return (
    <div className="content-section">
      <h2>أهلا وسهلا في البوابة الأكاديمية</h2>
      <div className="info-cards">
        <div className="info-card">
          <h3>📊 الدرجات</h3>
          <p>اطلع على درجاتك والنتائج الأكاديمية</p>
        </div>
        <div className="info-card">
          <h3>📚 المواد</h3>
          <p>عرض المواد المسجلة والجدول الدراسي</p>
        </div>
        <div className="info-card">
          <h3>👤 بياناتك</h3>
          <p>عرض وتحديث معلوماتك الشخصية</p>
        </div>
        <div className="info-card">
          <h3>📝 الطلبات</h3>
          <p>تقديم البلاغات والطلبات والمتابعة عليها</p>
        </div>
      </div>
    </div>
  );
}

function PersonalDataSection() {
  return (
    <div className="content-section">
      <h2>عرض وتحديث البيانات الشخصية</h2>
      <div className="form-section">
        <div className="form-group">
          <label>الاسم الكامل</label>
          <input type="text" value="الضابط المرشح/ مظهر خلفان الخروصي" disabled />
        </div>
        <div className="form-group">
          <label>رقم الهوية</label>
          <input type="text" value="1234567890" disabled />
        </div>
        <div className="form-group">
          <label>البريد الإلكتروني</label>
          <input type="email" value="madhhar@gmail.com" disabled />
        </div>
        <div className="form-group">
          <label>رقم الهاتف</label>
          <input type="tel" value="+966501234567" />
        </div>
        <div className="form-group">
          <label>العنوان</label>
          <textarea>سلطنة عمان | مسقط</textarea>
        </div>
        <button className="submit-btn">حفظ التعديلات</button>
      </div>
    </div>
  );
}

function GradesSection() {
  const grades = [
    { subject: 'الرياضيات', grade: 95, percentage: '95%' },
    { subject: 'الفيزياء', grade: 88, percentage: '88%' },
    { subject: 'الكيمياء', grade: 92, percentage: '92%' },
    { subject: 'اللغة العربية', grade: 90, percentage: '90%' },
  ];

  return (
    <div className="content-section">
      <h2>الاطلاع على الدرجات ونتائج الاختبارات</h2>
      <div className="grades-table">
        <table>
          <thead>
            <tr>
              <th>المادة</th>
              <th>الدرجة</th>
              <th>النسبة</th>
            </tr>
          </thead>
          <tbody>
            {grades.map((item, index) => (
              <tr key={index}>
                <td>{item.subject}</td>
                <td>{item.grade}</td>
                <td>{item.percentage}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CoursesSection() {
  const courses = [
    { code: '101', name: 'الرياضيات المتقدمة', instructor: 'أ.د محمد علي', time: 'السبت 9:00 AM' },
    { code: '102', name: 'الفيزياء التطبيقية', instructor: 'د.أحمد حسن', time: 'الأحد 10:30 AM' },
    { code: '103', name: 'الكيمياء العامة', instructor: 'د.خالد محمد', time: 'الاثنين 2:00 PM' },
  ];

  return (
    <div className="content-section">
      <h2>المواد المسجلة والجدول الدراسي</h2>
      <div className="courses-grid">
        {courses.map((course, index) => (
          <div key={index} className="course-card">
            <h3>{course.name}</h3>
            <p><strong>الكود:</strong> {course.code}</p>
            <p><strong>المحاضر:</strong> {course.instructor}</p>
            <p><strong>الوقت:</strong> {course.time}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdvisorSection() {
  return (
    <div className="content-section">
      <h2>معلومات المرشد الأكاديمي والتواصل معه</h2>
      <div className="advisor-card">
        <div className="advisor-info">
          <h3>أ.د محمد الجرادي</h3>
          <p><strong>التخصص:</strong> الهندسة المدنية</p>
          <p><strong>البريد الإلكتروني:</strong> m.alssiddique@college*****</p>
          <p><strong>رقم المكتب:</strong> +968********</p>
          <p><strong>ساعات المكتب:</strong> الأحد - الخميس من 2 PM إلى 4 PM</p>
          <p><strong>المكتب:</strong> الطابق الثاني، مبنى الكليات</p>
        </div>
        <button className="contact-btn">إرسال رسالة</button>
      </div>
    </div>
  );
}

function ReportsSection() {
  return (
    <div className="content-section">
      <h2>تقارير الفصول الدراسية</h2>
      <div className="reports-list">
        <div className="report-item">
          <h3>📋 تقرير الفصل الأول 2025</h3>
          <p>تاريخ التقرير: 20 ديسمبر 2024</p>
          <button className="download-btn">تحميل التقرير</button>
        </div>
        <div className="report-item">
          <h3>📋 تقرير الفصل الثاني 2024</h3>
          <p>تاريخ التقرير: 25 مايو 2024</p>
          <button className="download-btn">تحميل التقرير</button>
        </div>
        <div className="report-item">
          <h3>📋 تقرير الفصل الأول 2024</h3>
          <p>تاريخ التقرير: 22 ديسمبر 2023</p>
          <button className="download-btn">تحميل التقرير</button>
        </div>
      </div>
    </div>
  );
}

function ComplaintsSection() {
  return (
    <div className="content-section">
      <h2>رفع البلاغات والطلبات والمتابعة عليها</h2>
      <div className="complaints-form">
        <div className="form-group">
          <label>نوع الطلب</label>
          <select>
            <option>اختر نوع الطلب</option>
            <option>شكوى</option>
            <option>طلب معاملة إدارية</option>
            <option>طلب تأجيل الفصل</option>
            <option>طلب تعديل درجة</option>
          </select>
        </div>
        <div className="form-group">
          <label>الموضوع</label>
          <input type="text" placeholder="أدخل موضوع الطلب" />
        </div>
        <div className="form-group">
          <label>التفاصيل</label>
          <textarea placeholder="اشرح تفاصيل طلبك..."></textarea>
        </div>
        <button className="submit-btn">إرسال الطلب</button>
      </div>

      <h3 className="mt-40">الطلبات السابقة</h3>
      <div className="requests-history">
        <div className="request-item">
          <p><strong>الموضوع:</strong> طلب تعديل درجة في مادة الفيزياء</p>
          <p><strong>الحالة:</strong> <span className="status pending">قيد المراجعة</span></p>
          <p><strong>التاريخ:</strong> 15 يناير 2025</p>
        </div>
        <div className="request-item">
          <p><strong>الموضوع:</strong> شكوى من التأخر في الإعلان عن النتائج</p>
          <p><strong>الحالة:</strong> <span className="status completed">تم الرد</span></p>
          <p><strong>التاريخ:</strong> 10 يناير 2025</p>
        </div>
      </div>
    </div>
  );
}

function MoodleSection() {
  return (
    <div className="content-section">
      <h2>الوصول إلى نظام التعليم الإلكتروني (Moodle)</h2>
      <div className="moodle-section">
        <div className="moodle-info">
          <h3>منصة التعليم الإلكتروني</h3>
          <p>يمكنك الوصول إلى المحاضرات والمواد الدراسية والاختبارات الإلكترونية من خلال نظام Moodle</p>
          <div className="moodle-details">
            <p><strong>الرابط:</strong> https://moodle.college.edu.sa</p>
            <p><strong>اسم المستخدم:</strong> madhhar@college.edu.sa</p>
            <p><strong>كلمة المرور:</strong> نفس كلمة مرور البوابة</p>
          </div>
        </div>
        <a href="https://moodle.college.edu" target="_blank" rel="noopener noreferrer" className="moodle-btn">
          الذهاب إلى Moodle
        </a>
      </div>
    </div>
  );
}
