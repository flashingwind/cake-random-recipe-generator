"""Train the classifier on the agreed three features and export every class
probability on a 3D lattice, not just the winning class.
This is the only training program: the page's regions, its 2D projection and
the recipe points all come from the field written here. The field format is
estimator-agnostic; the estimator is pluggable via ESTIMATORS below and the
--model option (default: svm). Anchors are read from index.html (the ANCHORS
table); public recipes from data/recipes.json.
"""
import json
import re
from pathlib import Path
import numpy as np
from scipy.spatial import ConvexHull
from sklearn.svm import SVC
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.calibration import CalibratedClassifierCV
from sklearn.model_selection import LeaveOneGroupOut, cross_val_predict
from sklearn.neighbors import KernelDensity

ROOT=Path(__file__).resolve().parents[1]
FEATURES=['fat','egg','liquid']

# --- Pluggable estimators -------------------------------------------------
# An estimator builder returns a sklearn-style estimator (fit / predict /
# predict_proba / classes_), trained on raw features (scaling lives inside).
# The exported field does not depend on which estimator produced it.
def build_svm():
    return make_pipeline(StandardScaler(),CalibratedClassifierCV(SVC(C=2.0,gamma='scale'),cv=3))
from sklearn.base import BaseEstimator, ClassifierMixin
class KDEClassifier(BaseEstimator, ClassifierMixin):
    """Class-conditional Gaussian KDE on standardized features + Bayes rule.
    Experimental plug: a similarity field, not a margin classifier.
    A plug must satisfy the sklearn estimator interface (fit / predict /
    predict_proba / classes_) so cross-validation can clone it."""
    def __init__(self, bandwidth=None):
        self.bandwidth = bandwidth  # None = Scott's rule on standardized data
    def fit(self, X, y):
        self.scaler_=StandardScaler().fit(X)
        Z=self.scaler_.transform(X)
        self.classes_=np.array(sorted(set(y)))
        n, d = Z.shape
        h = self.bandwidth if self.bandwidth else n ** (-1.0 / (d + 4))
        self.models_={}
        self.log_prior_={}
        for c in self.classes_:
            Zc = Z[y == c]
            self.models_[c]=KernelDensity(bandwidth=h).fit(Zc)
            self.log_prior_[c]=np.log(len(Zc) / n)
        return self
    def predict_proba(self, X):
        Z=self.scaler_.transform(X)
        logp=np.column_stack([self.models_[c].score_samples(Z) + self.log_prior_[c] for c in self.classes_])
        logp-=logp.max(axis=1, keepdims=True)
        p=np.exp(logp)
        return p / p.sum(axis=1, keepdims=True)
    def predict(self, X):
        return self.classes_[np.argmax(self.predict_proba(X), axis=1)]
def build_kde():
    return KDEClassifier()
ESTIMATORS={
  'svm': ('RBF SVM C=2 gamma=scale + sigmoid calibration cv=3 (original estimator family)', build_svm),
  'kde': ('Class-conditional Gaussian KDE (Scott bandwidth) + Bayes; experimental', build_kde),
}
def parse_anchors():
    html=(ROOT/'index.html').read_text()
    block=re.search(r'const ANCHORS = (\[[\s\S]*?\n\]);', html).group(1)
    anchors=[]
    for obj in re.findall(r'\{([^}]*)\}', block):
        def s(key):
            return re.search(rf"{key}:'([^']*)'", obj).group(1)
        def n(key):
            return float(re.search(rf"{key}:([\d.]+)", obj).group(1))
        anchors.append({'id':s('id'),'name':s('name'),'color':s('color'),'method':s('method'),
                        'sugar':n('sugar'),'egg':n('egg'),'fat':n('fat'),'liquid':n('liquid'),'bp':n('bp')})
    bases={a['id']:a for a in anchors if not a['id'].endswith('-home')}
    rows=[]
    for a in anchors:
        base=bases[a['id'][:-5] if a['id'].endswith('-home') else a['id']]
        rows.append({**a,'category':base['name'],
                     'profile':'home' if a['id'].endswith('-home') else 'standard',
                     'kind':'anchor-estimate'})
    return anchors, rows
def main():
    import argparse
    parser=argparse.ArgumentParser()
    parser.add_argument('--model', choices=sorted(ESTIMATORS), default='svm')
    args=parser.parse_args()
    model_label, build_estimator = ESTIMATORS[args.model]
    def estimator():
        return build_estimator()
    from urllib.parse import urlparse
    anchors, anchor_rows = parse_anchors()
    base_by_name={a['name']:a for a in anchors if not a['id'].endswith('-home')}
    data=json.loads((ROOT/'data/recipes.json').read_text())['recipes']
    seen=set(); rows=[]
    for r in data:
        key=(r['source']['url'],r['category'],*(r[k] for k in ['fat','egg','sugar','liquid','bp']))
        if key not in seen:rows.append(r);seen.add(key)
    missing=sorted({r['category'] for r in rows}-set(base_by_name))
    if missing:
        raise SystemExit('Categories without an anchor in index.html: '+', '.join(missing))
    public=[{'id':r['id'],'category':r['category'],'name':r.get('name'),'flour':r.get('flour'),
             'sugar':r['sugar'],'egg':r['egg'],'fat':r['fat'],'liquid':r['liquid'],'bp':r['bp'],
             'method':r.get('method') or base_by_name[r['category']]['method'],
             'profile':r.get('profile') or 'home','color':base_by_name[r['category']]['color'],
             'source':r['source'],'kind':'public-recipe'} for r in rows]
    X=np.array([[r[k] for k in FEATURES] for r in rows]); y=np.array([r['category'] for r in rows])
    groups=np.array([urlparse(r['source']['url']).hostname for r in rows])
    pred=cross_val_predict(estimator(),X,y,groups=groups,cv=LeaveOneGroupOut())
    report={'model':model_label,'estimator':args.model,
      'features':FEATURES,'evaluation':'leave-one-source-host-out; public recipes only',
      'observed_recipes':len(rows),'correct':int((pred==y).sum()),'accuracy':float((pred==y).mean()),
      'per_category':{str(c):{'count':int((y==c).sum()),'correct':int(((y==c)&(pred==y)).sum())} for c in sorted(set(y))}}
    # Final training: public recipes plus the anchor estimates from index.html.
    Xall=np.vstack([X,[[r[k] for k in FEATURES] for r in anchor_rows]])
    final=estimator().fit(Xall,np.concatenate([y,[r['category'] for r in anchor_rows]]))
    domain_scale=np.array([110.,420.,400.])
    domain={'kind':'global-convex-hull','scale':domain_scale.tolist(),'equations':np.round(ConvexHull(Xall/domain_scale).equations,12).tolist(),'points':len(Xall)}
    axes=[list(range(0,111,5)),list(range(0,421,15)),list(range(0,401,20))]
    points=np.array([[f,e,w] for f in axes[0] for e in axes[1] for w in axes[2]])
    probs=final.predict_proba(points)
    out={'domain':domain,'model':report['model'],'estimator':args.model,'features':FEATURES,'classes':final.classes_.tolist(),'axes':axes,
      'order':'fat-major, egg, liquid, class','probabilities':np.round(probs,5).tolist(),'rows':public,
      'summary':{'publicRecipes':len(rows),'anchorEstimates':len(anchor_rows),'trainingTotal':len(rows)+len(anchor_rows),'anchorIds':[a['id'] for a in anchor_rows],'evaluation':report},
      'limits_note':'Continuous interpolated SVM scores describe category similarity, not measured baking outcomes or ingredient blend fractions.'}
    (ROOT/'data/svm-field.js').write_text('// Generated by python3 ml/train_continuous.py\nglobalThis.SVM_FIELD = '+json.dumps(out,ensure_ascii=False,separators=(',',':'))+';\n')
    (ROOT/'ml/continuous-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
