// PCの左メニューを畳んでいるかを覚える Cookie。
// **サーバー（app/(main)/layout.tsx）とブラウザ（Sidebar）の両方が読むので、"use client" のファイルに置かない。**
// "use client" のファイルからの書き出しは、サーバー側では値ではなく参照の代わりの物になる。
//
// localStorage ではなく Cookie にしているのは、最初の描画（サーバー）から畳んだ形で出すため。
// ブラウザだけで覚えると、サーバーは開いた形で描き、ブラウザで畳んだ形に描き直すことになり、
// 開いた瞬間に一度広がってから縮む上に、React が「サーバーと中身が違う」（#418/#425）を出す
export const SIDEBAR_COOKIE = "ss-sidebar";
export const SIDEBAR_COLLAPSED = "collapsed";
