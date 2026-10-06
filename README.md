# BeautyFlow

## שכבת שרת חדשה: Node.js + PostgreSQL

הפרויקט כולל כעת API חדש ב-[server](server) עבור ארכיטקטורה של מסד נתונים משותף עם schema נפרד לכל עסק. הוראות ההפעלה נמצאות ב-[server/README.md](server/README.md).

המערכת הקיימת עדיין משתמשת ב-Supabase עד שהמעבר של כל מסכי הממשק ל-API החדש יושלם. הדמו נשאר ללא שינוי.

## Oracle VM pilot

The isolated Docker trial lives in [deploy/pilot/README.md](deploy/pilot/README.md). Use its instructions for a fresh local database without changing the hosted site.
