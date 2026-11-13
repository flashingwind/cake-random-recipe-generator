#!/usr/bin/env python3
"""ケーキ分類器の学習: 公開レシピ（小麦粉100gあたり換算）からケーキの種類を分類する。

- 特徴量: [sugar, egg, fat, liquid, bp]（標準化）
- 本命: SVM (RBF) + 確率校正 / 対抗: 勾配ブースティング + 確率校正
- 評価: 層化交差検証（収集レシピのみで測る）。最終モデルは収集レシピ+アンカーで学習。
- 端クラス（粉なし）は比率座標への組み替えが前提のため、この版では対象外。
- 出力: report.txt（CV成績・混同行列）と model_grid.json（fat×egg 平面のクラス確率グリッド。
  sugar/liquid/bp はデータ中央値に固定。サイト側の領域色付けに使える）
"""
import json, glob, sys
import numpy as np
from sklearn.svm import SVC
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.calibration import CalibratedClassifierCV
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.model_selection import StratifiedKFold, cross_val_predict

BASE = '/home/hatch/workspace/cake-fix'
FEATURES = ['sugar', 'egg', 'fat', 'liquid', 'bp']

ANCHORS = [  # index.html のアンカー（カテゴリは基本形に寄せる）
    ('パウンドケーキ', 100, 100, 83, 0, 1), ('ジェノワーズ', 95, 190, 20, 20, 0),
    ('シフォンケーキ', 100, 300, 50, 65, 2), ('カステラ', 140, 240, 0, 30, 0),
    ('エンゼルフード', 135, 370, 0, 0, 0), ('ジェノワーズ', 114, 143, 24, 36, 0),
    ('シフォンケーキ', 100, 271, 43, 57, 0), ('カステラ', 157, 200, 0, 33, 0),
    ('エンゼルフード', 100, 210, 0, 0, 0), ('ホットケーキ', 24, 33, 0, 89, 4),
    ('クレープ', 24, 100, 17, 270, 0),
]

def load_recipes():
    rows = []
    d = json.load(open(f'{BASE}/recipes.json'))
    rows += d['recipes']
    for f in sorted(glob.glob(f'{BASE}/collect/*.json')):
        rows += json.load(open(f))
    # recipes.json へ統合済みの分が collect/ と重複するので、出典URL+数値で一意化
    seen, uniq = set(), []
    for r in rows:
        key = (r.get('category'), r.get('sugar'), r.get('egg'), r.get('fat'),
               r.get('liquid'), r.get('bp'), (r.get('source') or {}).get('url'))
        if key not in seen:
            seen.add(key); uniq.append(r)
    return uniq

def to_xy(rows):
    X = np.array([[float(r.get(k) or 0) for k in FEATURES] for r in rows])
    y = np.array([r['category'] for r in rows])
    return X, y

def main():
    rows = load_recipes()
    X, y = to_xy(rows)
    le = LabelEncoder().fit(list(set(y.tolist()) | {a[0] for a in ANCHORS}))
    yi = le.transform(y)
    classes = list(le.classes_)
    counts = {c: int((y == c).sum()) for c in classes}
    print('収集レシピ:', len(rows), '件 / クラス内訳:', counts)

    lines = [f'収集レシピ {len(rows)} 件', f'クラス内訳: {counts}', '']
    if len(classes) < 3 or min(counts.values()) < 3:
        lines.append('※ クラス数または最小クラス件数が不足しているため、CVは参考値。')

    def make_model(kind, calib_cv=3):
        if kind == 'svm':
            base = SVC(C=2.0, gamma='scale') if calib_cv >= 2 else SVC(C=2.0, gamma='scale', probability=True)
        else:
            base = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.08)
        if calib_cv >= 2:
            return make_pipeline(StandardScaler(), CalibratedClassifierCV(base, cv=calib_cv))
        return make_pipeline(StandardScaler(), base)

    folds = max(2, min(5, min(counts.values()))) if counts else 2
    cv = StratifiedKFold(folds, shuffle=True, random_state=42)
    results = {}
    for kind in ['svm', 'gbm']:
        model = make_model(kind)
        pred = cross_val_predict(model, X, yi, cv=cv)
        acc = float((pred == yi).mean())
        results[kind] = acc
        lines.append(f'== {kind}: CV正解率 {acc:.3f}')
        for ci, cname in enumerate(classes):
            mask = yi == ci
            if mask.sum():
                rec = float((pred[mask] == ci).mean())
                lines.append(f'   {cname}: 再現率 {rec:.2f}（{int(mask.sum())}件）')
        conf = np.zeros((len(classes), len(classes)), dtype=int)
        for t, p in zip(yi, pred):
            conf[t, p] += 1
        lines.append('   混同行列（行=正解, 列=予測）: ' + ' / '.join(classes))
        for cname, row in zip(classes, conf):
            lines.append(f'   {cname}: {row.tolist()}')
    best = max(results, key=results.get)
    lines.append(f'\n採用モデル: {best}（CV {results[best]:.3f}）')

    # 最終モデル: 収集レシピ + アンカーで学習
    Xa = np.array([[s, e, f, l, b] for _, s, e, f, l, b in ANCHORS], dtype=float)
    ya = le.transform([a[0] for a in ANCHORS])
    Xall = np.vstack([X, Xa]); yall = np.concatenate([yi, ya])
    final_counts = [int((yall == ci).sum()) for ci in range(len(classes)) if (yall == ci).any()]
    calib_cv = min(3, min(final_counts)) if final_counts else 0
    final = make_model(best, calib_cv=calib_cv if calib_cv >= 2 else 0).fit(Xall, yall)

    # fat×egg グリッド（他特徴量は収集データの中央値）
    med = np.median(X, axis=0)
    medmap = dict(zip(FEATURES, med))
    fats = list(range(0, 111, 5)); eggs = list(range(0, 421, 10))
    grid = []
    for e in eggs:
        row = []
        for f in fats:
            v = dict(medmap); v['fat'] = f; v['egg'] = e
            p = final.predict_proba([[v[k] for k in FEATURES]])[0]
            row.append({'class': classes[int(np.argmax(p))], 'p': round(float(np.max(p)), 3)})
        grid.append(row)
    out = {'classes': classes, 'fat_axis': fats, 'egg_axis': eggs,
           'fixed_at_median': {k: round(float(medmap[k]), 1) for k in ['sugar', 'liquid', 'bp']},
           'model': best, 'cv_accuracy': round(results[best], 3), 'grid': grid}
    json.dump(out, open(f'{BASE}/ml/model_grid.json', 'w'), ensure_ascii=False)
    open(f'{BASE}/ml/report.txt', 'w').write('\n'.join(lines) + '\n')
    print('\n'.join(lines))
    print('\nmodel_grid.json / report.txt を出力した')

if __name__ == '__main__':
    main()
