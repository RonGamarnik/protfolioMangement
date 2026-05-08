# מבנה מערכת המידע

המערכת בנויה כאפליקציה מקומית עם Frontend סטטי ושרת Python קטן שמנהל API ושמירה ב־MySQL.

## שכבות

- `index.html` ו־`src/` - שכבת UI מודולרית בקומפוננטות.
- `src/services` - לוגיקת שוק, חישובי תיק, ו־storage מול השרת.
- `sql-server.py` - קובץ הרצה קצר שנשאר בשביל תאימות לפקודת ההפעלה.
- `server/` - שכבת Backend מסודרת: קונפיגורציה, חיבור DB, Repository, HTTP handler והרצת שרת.
- `database/schema.sql` - סכמת MySQL מלאה שאפשר להריץ ידנית או להשתמש בה כתיעוד DB.
- `docs/` - תיעוד ארכיטקטורה ומבנה מערכת.

## מודל הנתונים

המערכת תומכת במספר משתמשים, מספר תיקים לכל משתמש, ושיתוף תיקים בין משתמשים עם הרשאות צפייה או עריכה.

- `users` - משתמשים, אימייל ו־hash של סיסמה.
- `user_sessions` - tokens פעילים כ־hash בצד השרת.
- `password_reset_tokens` - קודי איפוס סיסמה חד־פעמיים בני 6 ספרות כ־hash עם תוקף קצר, סטטוס שימוש וספירת ניסיונות.
- `portfolios` - תיקים פיננסיים לכל משתמש.
- `portfolio_positions` - האחזקות בפועל בתיק.
- `portfolio_transactions` - תנועות קנייה/מכירה עתידיות לצורך היסטוריה וניתוח ביצועים.
- `portfolio_shares` - בקשות והרשאות שיתוף תיק למשתמשים אחרים, כולל `VIEW` או `EDIT` וסטטוס `PENDING`/`ACCEPTED`.
- `portfolio_settings` - הגדרות UI ותיק בפורמט JSON.
- `market_symbols` - מידע עתידי על ניירות, בורסות ומטבעות.
- `market_cache` - נתוני שוק ושערים שנשמרים כדי לטעון מהר יותר.
- `fx_rates` - שערי מטבע עתידיים לפי מקור וזמן משיכה.
- `audit_events` - תשתית לתיעוד פעולות חשובות במערכת.

## חוזה API

- `POST /api/auth/register` - יצירת משתמש, תיק ראשי ו־session token.
- `POST /api/auth/login` - התחברות וקבלת token.
- `POST /api/auth/request-password-reset` - בקשת קוד איפוס סיסמה בלי לחשוף אם האימייל קיים.
- `POST /api/auth/confirm-password-reset` - עדכון סיסמה באמצעות קוד איפוס חד־פעמי; לא מחזיר token חדש.
- `POST /api/auth/logout` - ביטול token קיים.
- `GET /api/auth/me` - בדיקת token פעיל.
- `GET /api/health` - בדיקת זמינות השרת וה־DB.
- `GET /api/system` - מבנה מערכת בסיסי וספירת רשומות בטבלאות למשתמש מחובר.
- `GET /api/portfolios` - רשימת התיקים של המשתמש, כולל רק תיקים משותפים שהוא אישר.
- `POST /api/portfolios` - יצירת תיק חדש למשתמש המחובר.
- `PUT /api/portfolios/{portfolioId}` - שינוי שם תיק, לבעלים בלבד.
- `DELETE /api/portfolios/{portfolioId}` - מחיקת תיק, לבעלים בלבד.
- `GET /api/portfolio?portfolioId=...` - טעינת תיק שהמשתמש הוא בעלים שלו או קיבל אליו הרשאה.
- `PUT /api/portfolio?portfolioId=...` - שמירת מצב תיק, לבעלים או למשתמש עם הרשאת `EDIT`.
- `GET /api/portfolios/{portfolioId}/shares` - רשימת שיתופים לתיק, לבעלים בלבד.
- `POST /api/portfolios/{portfolioId}/shares` - שליחת בקשת שיתוף לפי אימייל והרשאה, לבעלים בלבד.
- `DELETE /api/portfolios/{portfolioId}/shares/{shareId}` - ביטול שיתוף, לבעלים בלבד.
- `GET /api/portfolio-share-requests` - בקשות שיתוף שממתינות לאישור המשתמש המחובר.
- `POST /api/portfolio-share-requests/{shareId}/accept` - אישור בקשת שיתוף.
- `DELETE /api/portfolio-share-requests/{shareId}` - דחיית בקשת שיתוף.
- `POST /api/ai/portfolio-insights` - יצירת תובנות תיק בצד השרת. אם מוגדר `OPENAI_API_KEY` הקריאה יוצאת ל־OpenAI; אחרת מתקבל ניתוח מקומי.

ה־Frontend שולח את ה־token בכותרת `Authorization: Bearer ...`. אין שמירה של תיק, אחזקות או נתוני לקוח בדפדפן.
ה־token עצמו נשמר בטבלת `user_sessions` כ־hash, והעותק בצד הדפדפן נשמר רק ב־`sessionStorage` כדי לאפשר רענון בלי התנתקות.

## הגדרות פרודקשן חשובות

- `APP_ENV=production` מונע החזרת קוד איפוס למסך. בפרודקשן צריך להגדיר SMTP כדי שהקוד יישלח במייל.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_TLS`, `SMTP_SSL` משמשים לשליחת קודי איפוס סיסמה. עבור Gmail בפורט `465` יש להשתמש ב־`SMTP_SSL=1`.
- `OPENAI_API_KEY` ו־`OPENAI_MODEL` מפעילים את כפתור AI מול OpenAI בלי לחשוף מפתח לדפדפן.
- השרת מוסיף headers בסיסיים: CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` ו־`Permissions-Policy`.

## מיגרציה

בעת ההפעלה השרת:

1. יוצר את סכמת MySQL אם היא חסרה.
2. יוצר משתמש ותיק ברירת מחדל.
3. אם קיימות הטבלאות הישנות `holdings`, `settings`, `cached_market`, והסכמה החדשה עדיין ריקה, הוא מעביר את הנתונים לתיק ברירת המחדל.
4. אם אין נתונים ב־MySQL וקיים קובץ `data/portfolio.db`, הוא מנסה מיגרציה מ־SQLite.
5. החשבון האמיתי הראשון שנרשם מקבל את תיק ברירת המחדל אם כבר היו בו אחזקות.

הטבלאות הישנות לא נמחקות אוטומטית כדי לא לסכן מידע קיים.
