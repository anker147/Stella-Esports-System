const CHINA_COUNTRY_NAMES = new Set([
  'china', 'cn', 'chn', '中国', '中华人民共和国', "people's republic of china"
]);

const CHINA_PROVINCE_ALIASES = new Map([
  ['beijing', '北京市'], ['tianjin', '天津市'], ['shanghai', '上海市'], ['chongqing', '重庆市'],
  ['hebei', '河北省'], ['shanxi', '山西省'], ['liaoning', '辽宁省'], ['jilin', '吉林省'],
  ['heilongjiang', '黑龙江省'], ['jiangsu', '江苏省'], ['zhejiang', '浙江省'], ['anhui', '安徽省'],
  ['fujian', '福建省'], ['jiangxi', '江西省'], ['shandong', '山东省'], ['henan', '河南省'],
  ['hubei', '湖北省'], ['hunan', '湖南省'], ['guangdong', '广东省'], ['hainan', '海南省'],
  ['sichuan', '四川省'], ['guizhou', '贵州省'], ['yunnan', '云南省'], ['shaanxi', '陕西省'],
  ['gansu', '甘肃省'], ['qinghai', '青海省'], ['taiwan', '台湾省'],
  ['inner mongolia', '内蒙古自治区'], ['neimenggu', '内蒙古自治区'],
  ['guangxi', '广西壮族自治区'], ['xizang', '西藏自治区'], ['tibet', '西藏自治区'],
  ['ningxia', '宁夏回族自治区'], ['xinjiang', '新疆维吾尔自治区'],
  ['hong kong', '香港特别行政区'], ['hongkong', '香港特别行政区'],
  ['macao', '澳门特别行政区'], ['macau', '澳门特别行政区']
]);

const CHINA_CITY_ALIASES = new Map([
  ['mianyang', '绵阳市']
]);

const CHINA_PROVINCE_SUFFIX = /(省|市|自治区|特别行政区)$/u;
const CHINA_CITY_SUFFIX = /(市|地区|自治州|盟|县|自治县|旗|自治旗|林区)$/u;
const MUNICIPALITIES = new Set(['北京市', '天津市', '上海市', '重庆市']);
const CHINA_PROVINCE_NAME = /^(北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门)(省|市|自治区|壮族自治区|回族自治区|维吾尔自治区|特别行政区)?$/u;

function text(value) {
  return String(value || '').trim().slice(0, 80);
}

function latinKey(value) {
  return text(value).toLowerCase()
    .replace(/\b(sheng|shi|zhuangzu zizhiqu|huizu zizhiqu|uygur zizhiqu|zizhiqu)\b/g, '')
    .replace(/[^a-z]+/g, ' ').trim();
}

function hasHan(value) {
  return /\p{Script=Han}/u.test(text(value));
}

function isChina(country, countryCode, province) {
  const normalizedCountry = text(country).toLowerCase();
  const normalizedCode = text(countryCode).toLowerCase();
  return CHINA_COUNTRY_NAMES.has(normalizedCountry)
    || CHINA_COUNTRY_NAMES.has(normalizedCode)
    || CHINA_PROVINCE_NAME.test(text(province));
}

function chinaProvince(value) {
  const raw = text(value);
  if (!raw) return '';
  const alias = CHINA_PROVINCE_ALIASES.get(latinKey(raw));
  if (alias) return alias;
  if (!hasHan(raw)) return raw;
  if (CHINA_PROVINCE_SUFFIX.test(raw)) return raw;
  if (['北京', '天津', '上海', '重庆'].includes(raw)) return `${raw}市`;
  if (raw === '内蒙古' || raw === '西藏') return `${raw}自治区`;
  if (raw === '广西') return '广西壮族自治区';
  if (raw === '宁夏') return '宁夏回族自治区';
  if (raw === '新疆') return '新疆维吾尔自治区';
  if (raw === '香港' || raw === '澳门') return `${raw}特别行政区`;
  return `${raw}省`;
}

function chinaCity(value) {
  const raw = text(value);
  if (!raw) return '';
  const alias = CHINA_CITY_ALIASES.get(latinKey(raw));
  if (alias) return alias;
  if (!hasHan(raw)) return raw;
  return CHINA_CITY_SUFFIX.test(raw) ? raw : `${raw}市`;
}

function formatGeoRegion(input = {}) {
  const country = text(input.country);
  const countryCode = text(input.countryCode || input.country_code);
  const provinceInput = text(input.province || input.pro || input.region);
  const cityInput = text(input.city);
  if (isChina(country, countryCode, provinceInput)) {
    const province = chinaProvince(provinceInput);
    const city = chinaCity(cityInput);
    if (MUNICIPALITIES.has(province)) return province;
    if (province && city && province.replace(CHINA_PROVINCE_SUFFIX, '') === city.replace(CHINA_CITY_SUFFIX, '')) {
      return province;
    }
    return [province, city].filter(Boolean).join('') || '中国';
  }
  const fallback = text(input.fallback || input.addr);
  const parts = [...new Set([country, provinceInput, cityInput].filter(Boolean))];
  return parts.join(' · ') || fallback || '未知地区';
}

function providerGeoRegion(data = {}) {
  const provinceCode = text(data.proCode || data.provinceCode);
  const providerSaysChina = Boolean(text(data.pro || data.province))
    && provinceCode !== '999999';
  return formatGeoRegion({
    country: data.country || data.country_name || (providerSaysChina ? '中国' : ''),
    countryCode: data.country_code || data.countryCode || (providerSaysChina ? 'CN' : ''),
    province: data.pro || data.province || data.region,
    city: data.city,
    fallback: data.addr
  });
}

function needsLocalizedLookup(location = {}) {
  const region = text(location.region);
  if (!region || region === '未知地区') return true;
  const looksChineseLocation = /(^| · )(cn|chn|china)( · |$)/i.test(region)
    || /\b(sheng|shi|zizhiqu)\b/i.test(region);
  return looksChineseLocation && /[a-z]/i.test(region);
}

function normalizeStoredRegion(value) {
  const raw = text(value);
  if (!raw || raw === '未知地区' || raw === '本机网络') return raw || '未知地区';
  const parts = raw.split(/\s*·\s*/).filter(Boolean);
  if (parts.length < 2) return raw;
  const normalized = formatGeoRegion({ country: parts[0], region: parts[1], city: parts[2] });
  const sourceIsChina = CHINA_COUNTRY_NAMES.has(parts[0].toLowerCase());
  if (sourceIsChina && /[a-z]/i.test(normalized)) return raw;
  return normalized;
}

async function readGeoJson(response) {
  const charset = String(response.headers.get('content-type') || '').match(/charset=([^;\s]+)/i)?.[1] || 'utf-8';
  const encoding = /^(gbk|gb2312|gb18030)$/i.test(charset) ? 'gb18030' : 'utf-8';
  const body = new TextDecoder(encoding).decode(await response.arrayBuffer()).trim();
  return JSON.parse(body);
}

module.exports = { formatGeoRegion, needsLocalizedLookup, normalizeStoredRegion, providerGeoRegion, readGeoJson };
