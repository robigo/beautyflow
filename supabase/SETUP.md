# חיבור BeautyFlow ל-Supabase

1. צור פרויקט חדש ב-[Supabase](https://supabase.com/dashboard).
2. פתח את `SQL Editor`, הדבק את תוכן `schema.sql` והרץ אותו פעם אחת.
3. ב-Authentication > Providers הפעל Email. מומלץ להשאיר אימות אימייל פעיל.
4. ב-Project Settings > API העתק את `Project URL` ואת ה-`anon`/`publishable key`.
5. הדבק אותם ב-`SUPABASE_URL` וב-`SUPABASE_ANON_KEY` בקובץ `index.html`.

הסכמה מפרידה נתונים לפי `business_id` ובעל העסק המחובר. מדיניות RLS מונעת מבעל עסק לראות תורים, לקוחות ולידים של עסק אחר.

## הערה על קישור הלקוחות

הטבלה `leads` מאפשרת הכנסת ליד ללא התחברות. היא אינה מאפשרת קריאת מידע. כך טופס הלקוח יכול לשלוח פנייה, ובעל העסק בלבד יכול לראות אותה בממשק שלו.

השלב הבא בקוד הוא החלפת שכבת `localStorage` בקריאות Supabase, לאחר קבלת ה-URL והמפתח הציבורי של הפרויקט.

## מנהל מערכת

אחרי יצירת חשבון המנהל הראשון, יש להריץ גם את `platform_admin.sql` ב-SQL Editor. הוא מעניק ל-`goshen.r@gmail.com` הרשאת מנהל מערכת כללית ברמת השרת.
