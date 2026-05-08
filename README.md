# Portfolio Live - הוראות הפעלה

אפליקציה מקומית לניהול תיק מניות לפי חשבון משתמש, עם מחירי שוק, שווי בדולרים ובשקלים, ושמירה ל־MySQL.

## דרישות

- דפדפן מודרני כמו Chrome או Edge.
- Python 3 מותקן במחשב.
- MySQL Server רץ מקומית או בשרת נגיש.
- חיבור אינטרנט בשביל משיכת מחירי מניות ושער `USD/ILS`.

## התקנת תלות Python

```powershell
pip install -r requirements.txt
```

## הרצה מקומית

פתח PowerShell בתיקיית הפרויקט והריץ:

```powershell
cd "C:\Users\yuval\OneDrive\Desktop\Portfolio project"
python sql-server.py
```

הגדרות חיבור, סיסמאות ומפתחות API נטענים אוטומטית מקובץ `.env` בתיקיית הפרויקט. מלא שם את `MYSQL_PASSWORD`, `OPENAI_API_KEY` ופרטי `SMTP_*` אם צריך.

לאחר מכן פתח בדפדפן:

```text
http://127.0.0.1:4173
```

אם פורט `4173` תפוס, השרת יעבור אוטומטית לפורט הבא וידפיס את הכתובת בטרמינל.

## שמירה ומבנה מערכת מידע ב-MySQL

השרת `sql-server.py` מתחבר ל־MySQL ומפעיל את מבנה המערכת מתוך תיקיית `server`.
הוא יוצר database בשם `portfolio_live` אם אין כזה, ויוצר סכמת מידע מנורמלת:

- `users`
- `user_sessions`
- `password_reset_tokens`
- `portfolios`
- `portfolio_positions`
- `portfolio_transactions`
- `portfolio_shares`
- `portfolio_settings`
- `market_symbols`
- `market_cache`
- `fx_rates`
- `audit_events`

קובץ הסכמה המלא נמצא ב־`database/schema.sql`, ותיאור מבנה המערכת נמצא ב־`docs/SYSTEM_STRUCTURE.md`.
ה־Frontend עובד מול API מאובטח. כל משתמש רואה את התיקים שלו ואת התיקים ששיתפו איתו רק אחרי שהוא אישר את בקשת השיתוף, ושמירה מתאפשרת רק לבעלים או למשתמש שקיבל הרשאת עריכה.

אפשר לשנות את החיבור דרך קובץ `.env` או דרך משתני סביבה:

```text
MYSQL_HOST
MYSQL_PORT
MYSQL_USER
MYSQL_PASSWORD
MYSQL_DATABASE
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASSWORD
SMTP_FROM
SMTP_TLS
SMTP_SSL
OPENAI_API_KEY
OPENAI_MODEL
```

אם קיימות הטבלאות הישנות `holdings`, `settings`, `cached_market`, השרת יעביר את הנתונים לסכמה החדשה כשהתיק החדש עדיין ריק.
אם קיים קובץ SQLite ישן ב־`data/portfolio.db`, השרת ינסה לבצע מיגרציה חד־פעמית ל־MySQL כשהסכמה החדשה עדיין ריקה. אחרי זה השמירה היא ל־MySQL בלבד.

אפשר לבדוק את מבנה המערכת אחרי התחברות דרך:

```text
http://127.0.0.1:4173/api/system
```

חשוב לדעת: נתוני תיק, אחזקות, הגדרות ונתוני לקוח לא נשמרים ב־`localStorage`, ב־cookies או בקבצים מקומיים של הדפדפן.
רק token התחברות נשמר ב־`sessionStorage` כדי שרענון של אותו טאב לא ינתק את החשבון.
בצד השרת ה־token נשמר כ־hash בטבלת `user_sessions`.
אחרי סגירת הטאב תידרש התחברות מחדש.

בהרשמה הראשונה במערכת, אם כבר קיים תיק שהועבר מהגרסה הישנה, התיק ישויך אוטומטית לחשבון הראשון שנוצר.

אם הסיסמה לא ידועה, לחץ במסך הכניסה על `איפוס סיסמה`. המערכת תשלח קוד איפוס חד־פעמי בן 6 ספרות, ורק אחרי הזנת האימייל, הקוד והסיסמה החדשה הסיסמה תתעדכן.

להכנה לפרודקשן מומלץ להגדיר:

```text
APP_ENV=production
APP_BASE_URL=https://your-domain.example
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASSWORD
SMTP_FROM
SMTP_TLS
SMTP_SSL
OPENAI_API_KEY
OPENAI_MODEL
```

`OPENAI_API_KEY` מפעיל את כפתור `AI` בראש הדף דרך שרת Python, כך שהמפתח לא נשלח לדפדפן.
עבור Gmail עם `SMTP_PORT=465` צריך `SMTP_SSL=1`. אם משתמשים ב־`SMTP_PORT=587`, השתמש ב־`SMTP_TLS=1` ו־`SMTP_SSL=0`.

אם מתקבלת שגיאת `Access denied`, צריך לוודא שהמשתמש קיים עם הרשאות ל־localhost. דרך MySQL Workbench או משתמש admin הרץ:

```sql
CREATE USER IF NOT EXISTS 'portfolio'@'localhost' IDENTIFIED BY 'your_password';
CREATE DATABASE IF NOT EXISTS portfolio_live CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON portfolio_live.* TO 'portfolio'@'localhost';
FLUSH PRIVILEGES;
```

## חשוב

לא לפתוח את `index.html` בלחיצה כפולה. האפליקציה טוענת קבצי קומפוננטות דרך `fetch`, ולכן היא צריכה לרוץ דרך שרת מקומי ולא דרך `file://`.

## שימוש באפליקציה

1. הוספת מנייה:
   - הכנס סימול כמו `AAPL`, `MSFT`, `NVDA`.
   - לניירות מחוץ לארה"ב אפשר להשתמש בסימול שתואם ל־Yahoo, למשל `BMW.DE`.
   - קיצורים נפוצים כמו `RHM` ו־`LDO` מזוהים אוטומטית כ־`RHM.DE` ו־`LDO.MI`.
   - הכנס סכום השקעה בדולר.
   - הכנס מחיר קנייה, או לחץ על `מחיר נוכחי`.
   - אם הנייר לא נסחר בבורסה אמריקאית ומטבע המסחר אינו `USD`, האפליקציה תשאל אם מחיר הקנייה שהזנת הוא במטבע המקומי של הנייר.
   - לחץ `הוסף`.

## מטבעות וניירות מחוץ לארה"ב

סכום ההשקעה הכולל נשאר בדולרים, אבל מחיר הקנייה ומחיר השוק יכולים להיות במטבע המסחר של הנייר, למשל `EUR`, `GBP`, `CHF` או `CAD`.

בעת הוספת נייר:

- אם הנייר אמריקאי, אין שאלת מטבע.
- אם הנייר לא אמריקאי והמטבע שונה מ־`USD`, תופיע שאלת אישור.
- בחירה באישור אומרת שמחיר הקנייה שהזנת הוא במטבע המקומי.
- בחירה בביטול אומרת שמחיר הקנייה שהזנת הוא בדולר.

האפליקציה ממירה את השווי לדולרים, ומשם לשקלים.

2. בניית תיק לפי אחוזים:
   - הכנס סכום השקעה כולל.
   - מלא סימול, אחוז ומחיר קנייה לכל מנייה.
   - ודא שסך האחוזים הוא `100%`.
   - לחץ `בנה תיק`.

3. שמירה:
   - בהרצה עם `python sql-server.py`, התיק נשמר אוטומטית ב־MySQL תחת החשבון המחובר.
   - צריך להריץ את שרת ה־MySQL המקומי כדי שהאפליקציה תיטען ותשמור.
   - בכניסה הבאה, אחרי התחברות לאותו חשבון, הנתונים יחזרו אוטומטית מ־MySQL.

4. ייצוא וייבוא:
   - כפתור ההורדה מייצא את התיק לקובץ JSON.
   - כפתור ההעלאה מייבא תיק מקובץ JSON.

## מקורות נתונים

האפליקציה מנסה למשוך נתונים מ־Yahoo Finance. אם Yahoo לא זמין מהדפדפן, היא משתמשת ב־fallback דרך Stooq. שער `USD/ILS` נמשך מאותם מקורות, עם fallback נוסף של Frankfurter.

אם מחירים לא נטענים:

- ודא שיש חיבור אינטרנט.
- נסה לרענן שוב.
- ודא שהסימול תקין.
- לסימולים לא אמריקאיים ייתכן שצריך סימול אחר שתואם ל־Yahoo Finance.

## עצירת השרת

אם הרצת את השרת בחלון PowerShell רגיל, לחץ:

```text
Ctrl + C
```

אם השרת רץ ברקע ורוצים לעצור אותו:

```powershell
Get-Process python | Stop-Process
```

## Railway deployment notes

The app can run on Railway with the included `Procfile`.

Set these environment variables in Railway instead of committing a `.env` file:

```text
APP_ENV=production
APP_BASE_URL=https://your-railway-domain
MYSQL_HOST
MYSQL_PORT
MYSQL_USER
MYSQL_PASSWORD
MYSQL_DATABASE
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASSWORD
SMTP_FROM
SMTP_TLS
SMTP_SSL
OPENAI_API_KEY
OPENAI_MODEL
```

Do not set `HOST` on Railway unless needed; in production the server defaults to `0.0.0.0`.
