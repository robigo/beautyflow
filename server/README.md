# BeautyFlow API

שרת Node.js עבור BeautyFlow, עם PostgreSQL משותף ו-schema נפרד לכל עסק.

## הפעלה מקומית

1. העתיקו את `.env.example` אל `.env` והגדירו `DATABASE_URL` ו-`JWT_SECRET`.
2. הריצו `npm install`.
3. הריצו `npm run db:migrate` פעם אחת ליצירת טבלאות הפלטפורמה.
4. הריצו `npm run dev`.

השרת זמין כברירת מחדל ב-`http://localhost:3000`.

## GitHub Codespaces לפיתוח

הפרויקט כולל `docker-compose.yml` ו-`.devcontainer/devcontainer.json`. בפתיחת Codespace יופעל PostgreSQL מקומי לפיתוח, תיווצר תצורת `.env`, ויורצו התקנת החבילות והמיגרציה. מסד הנתונים שב-Codespace הוא **לפיתוח בלבד**; פרודקשן צריך `DATABASE_URL` של PostgreSQL מנוהל.

## פריסה חינמית: Neon + Vercel

1. צרו פרויקט Free ב-Neon ובחרו אזור קרוב למשתמשים.
2. העתיקו מ-Neon את **pooled connection string** עם `sslmode=require`.
3. ב-Vercel לחצו `Add New` → `Project`, חברו את מאגר GitHub, והגדירו את **Root Directory** ל-`server`.
4. הוסיפו ב-Vercel את `DATABASE_URL` מ-Neon ואת `CLIENT_ORIGIN` בערך `https://robigo.github.io`. הגדירו גם `JWT_SECRET` כמחרוזת אקראית ארוכה.
5. הפריסה מריצה את `vercel-build`, ולכן מיגרציית הפלטפורמה נוצרת אוטומטית. בסיום, העתיקו את כתובת ה-API של Vercel לחיבור הממשק.

הקובץ `src/index.js` הוא נקודת הכניסה של Vercel ל-Express. כך אין צורך ב-Render או בפרטי תשלום רק כדי לפרוס את ה-API הראשוני.

## מודל בידוד הנתונים

- `public.app_users` מכילה חשבונות משתמשים.
- `public.businesses` ממפה כל עסק לבעלים ול-`schema_name` פנימי.
- בעת פתיחת עסק, השרת יוצר schema בשם `tenant_<uuid>` ומתקין בו את כל טבלאות העבודה: לקוחות, תורים, לידים, שירותים, רשימת המתנה וחבילות.
- הלקוח לעולם אינו שולח שם schema. בכל בקשה השרת מאמת JWT, מאתר עסק בבעלות המשתמש, ורק אז מגדיר `search_path` לעסק הזה בתוך transaction.

כך מסד נתונים אחד משותף לכל BeautyFlow, בעוד הנתונים של כל עסק נמצאים בטבלאות נפרדות לחלוטין.

## נקודות קצה ראשונות

| פעולה | כתובת |
| --- | --- |
| הרשמה | `POST /api/auth/register` |
| כניסה | `POST /api/auth/login` |
| רשימת עסקים | `GET /api/businesses` |
| יצירת עסק ו-schema | `POST /api/businesses` |
| טעינת סביבת עסק | `GET /api/businesses/:businessId/workspace` |
| משאבים / אנשי צוות | `GET/POST /api/businesses/:businessId/resources` |
| שירות מפורט | `POST /api/businesses/:businessId/services` |
| חסימת זמן | `POST /api/businesses/:businessId/time-blocks` |
| קביעת תור | `POST /api/businesses/:businessId/appointments` |
| טופס לקוח ציבורי | `GET/POST /api/public/businesses/:publicId/...` |

כל נקודות הקצה של בעל עסק דורשות כותרת `Authorization: Bearer <token>`.

בקביעת תור אפשר לשלוח `serviceId` ו-`resourceId`. השרת מחשב את זמן הסיום על פי משך השירות וה-buffer, בודק חסימות ידניות, ומסד הנתונים מונע חפיפה של תורים לאותו משאב גם במקרה של שתי בקשות בו-זמנית.
