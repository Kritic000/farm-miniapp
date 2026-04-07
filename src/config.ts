const GS_API_URL =
  "https://script.google.com/macros/s/AKfycbw5ljb1uQHfgfTad0BG3O7Rx9yKlsM6Qo3Hso3AexjXP410oUX_PwSp15eogowchqRspw/exec";

const GS_API_TOKEN = "Kjhytccb18@";

export const API_PRODUCTS_URL = `${GS_API_URL}?action=products`;

export const API_ORDER_URL = GS_API_URL;

export const API_ORDERS_URL = `${GS_API_URL}?action=orders&token=${encodeURIComponent(
  GS_API_TOKEN
)}`;

export const API_CANCEL_URL = GS_API_URL;

export const API_TOKEN = GS_API_TOKEN;
