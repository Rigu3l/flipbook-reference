/* Flipbook Reference — configuration.
   Same Supabase project as Manuazine. These are PUBLIC anon-key
   values (Project Settings > API); Row Level Security controls
   what anon users can do. NEVER put the service_role key here. */
window.FLIPBOOK_CONFIG = {
  SUPABASE_URL: 'https://kgvfoxkjtbuzfjcfpxtm.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtndmZveGtqdGJ1emZqY2ZweHRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMwODYzNjIsImV4cCI6MjEwODY2MjM2Mn0.v_GQRQeGOtFfxwgKAZhoMO-okLu1aaT5YMQKBJNywGs',
  BUCKET: 'pdfs',
  MAX_FILE_BYTES: 30 * 1024 * 1024 // 30 MB
};

window.FLIPBOOK_CONFIGURED = function () {
  var c = window.FLIPBOOK_CONFIG || {};
  return Boolean(c.SUPABASE_URL) && c.SUPABASE_URL.indexOf('YOUR_PROJECT_REF') === -1 &&
    Boolean(c.SUPABASE_ANON_KEY) && c.SUPABASE_ANON_KEY.indexOf('YOUR_SUPABASE_ANON_KEY') === -1;
};
