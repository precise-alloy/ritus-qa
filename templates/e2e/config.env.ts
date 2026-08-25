interface ENV {
  TEST_BASE_URL: string | undefined;
  CMS_EMAIL: string | undefined;
  CMS_PASSWORD: string | undefined;
  HAS_COOKIE_BANNER: string | undefined;
  SKIP_AUTH: string | undefined;
  CI: string | undefined;
}

interface GlobalENV {
  TEST_BASE_URL: string;
  CMS_EMAIL: string;
  CMS_PASSWORD: string;
  HAS_COOKIE_BANNER: boolean;
  SKIP_AUTH: boolean;
  CI: boolean;
}

const getENV = (): ENV => ({
  TEST_BASE_URL: process.env.TEST_BASE_URL,
  CMS_EMAIL: process.env.CMS_EMAIL,
  CMS_PASSWORD: process.env.CMS_PASSWORD,
  HAS_COOKIE_BANNER: process.env.HAS_COOKIE_BANNER,
  SKIP_AUTH: process.env.SKIP_AUTH,
  CI: process.env.CI,
});

const getGlobalENV = (env: ENV): GlobalENV => {
  const missing = Object.entries(env)
    .filter(([, value]) => value === undefined || value === '')
    .map(([key]) => key);
  // CI is optional (defaults to false outside CI runners)
  const required = missing.filter((k) => k !== 'CI');
  if (required.length > 0) {
    throw new Error(`Missing key(s) in .env file: ${required.join(', ')}`);
  }
  return {
    TEST_BASE_URL: env.TEST_BASE_URL!,
    CMS_EMAIL: env.CMS_EMAIL!,
    CMS_PASSWORD: env.CMS_PASSWORD!,
    HAS_COOKIE_BANNER: env.HAS_COOKIE_BANNER!.toLowerCase() === 'true',
    SKIP_AUTH: env.SKIP_AUTH!.toLowerCase() === 'true',
    CI: (env.CI ?? 'false').toLowerCase() === 'true',
  };
};

const globalENV = getGlobalENV(getENV());

export default globalENV;
