/** Lowercase and strip Vietnamese diacritics so "dien thoai" finds "Điện thoại". */
export function foldText(value: string) {
  return value
    .toLocaleLowerCase("vi")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d");
}
