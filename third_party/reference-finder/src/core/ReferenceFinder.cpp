/******************************************************************************
File:         ReferenceFinder.cpp
Project:      ReferenceFinder 4.x
Purpose:      Implementation for ReferenceFinder generic model
Author:       Robert J. Lang
Modified by:  Mu-Tsun Tsai, Omri Shavit
Created:      2006-04-22
Copyright:    ©1999-2007 Robert J. Lang. All Rights Reserved.
******************************************************************************/

#include "ReferenceFinder.h"

#include <algorithm>
#include <fstream>
#include <iomanip>
#include <sstream>

#include "math/paper.h"

#include "database/binaryInputStream.hpp"
#include "database/optimizer.h"

#include "class/refLine/refLineOriginal.h"
#include "class/refMark/refMarkIntersection.h"
#include "class/refMark/refMarkOriginal.h"

#include "class/refLine/refLineC2PC2P.h"
#include "class/refLine/refLineL2L.h"
#include "class/refLine/refLineL2LC2P.h"
#include "class/refLine/refLineL2LP2L.h"
#include "class/refLine/refLineP2LC2P.h"
#include "class/refLine/refLineP2LP2L.h"
#include "class/refLine/refLineP2P.h"

using namespace std;

/**********
class ReferenceFinder - object that builds and maintains collections of marks
and lines and can search through the collection for marks and lines close to a
target mark or line. This class is the primary interface to the ReferenceFinder
database.
**********/

// Letters that are used for labels for marks and lines.
std::array<const char, 10> RefLine::sLabels = {'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'};
std::array<const char, 11> RefMark::sLabels = {'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'};

/*****
private static member initialization
*****/
RefContainer<RefLine> ReferenceFinder::sBasisLines;
RefContainer<RefMark> ReferenceFinder::sBasisMarks;
ReferenceFinder::DatabaseFn ReferenceFinder::sDatabaseFn = nullptr;
void *ReferenceFinder::sDatabaseUserData = nullptr;
ReferenceFinder::StatisticsFn ReferenceFinder::sStatisticsFn = nullptr;
void *ReferenceFinder::sStatisticsUserData = nullptr;
int ReferenceFinder::sStatusCount = 0;
rank_t ReferenceFinder::sCurRank = 0;
const char *ReferenceFinder::db_path = "/data/db";

bool ReferenceFinder::ShowProgress(DatabaseStatus status, rank_t rank) {
	bool haltFlag = false;
	if(sDatabaseFn) {
		(*sDatabaseFn)(
			DatabaseInfo(status, rank, GetNumLines(), GetNumMarks()),
			sDatabaseUserData, haltFlag
		);
	}
	return haltFlag;
}

void ReferenceFinder::print_ref_sizes() {
	cout << "RefBase: " << sizeof(RefBase) << endl;
	cout << "RefMark: " << sizeof(RefMark) << endl;
	cout << "RefMark_Intersection: " << sizeof(RefMark_Intersection) << endl;
	cout << "RefLine: " << sizeof(RefLine) << endl;
	cout << "RefLine_C2P_C2P: " << sizeof(RefLine_C2P_C2P) << endl;
	cout << "RefLine_P2P: " << sizeof(RefLine_P2P) << endl;
	cout << "RefLine_L2L: " << sizeof(RefLine_L2L) << endl;
	cout << "RefLine_L2L_C2P: " << sizeof(RefLine_L2L_C2P) << endl;
	cout << "RefLine_P2L_C2P: " << sizeof(RefLine_P2L_C2P) << endl;
	cout << "RefLine_P2L_P2L: " << sizeof(RefLine_P2L_P2L) << endl;
	cout << "RefLine_L2L_P2L: " << sizeof(RefLine_L2L_P2L) << endl;
}

/*****
Routine called by RefContainer<R> to report progress during the time-consuming
process of initialization. This routine updates our private counter each time
it's called and only occasionally passes on a full call to sDatabaseFn. Clients
can adjust the frequency of calling by changing the variable
sDatabaseStatusSkip. If the client DatabaseFn sets the value of haltFlag to
true, we immediately terminate construction of references.
*****/
void ReferenceFinder::CheckDatabaseStatus() {
	if(sStatusCount < Shared::sDatabaseStatusSkip)
		sStatusCount++;
	else {
		if(ShowProgress(DATABASE_WORKING, sCurRank)) throw EXC_HALT();
		sStatusCount = 0;
	}
}

/*****
Create all marks and lines of a given rank.
*****/
void ReferenceFinder::MakeAllMarksAndLinesOfRank(rank_t arank) {
	sCurRank = arank;

	// Construct all types of lines of the given rank. Note that the order in
	// which we call the MakeAll() functions determines which types of RefLine
	// get built, since the first object with a given key to be constructed gets
	// the key slot.

	// The original priority given by Lang was 3276541,
	// in which we first give preference to lines that don't involve making creases through points,
	// because these are the hardest to do accurately in practice.
	// Next, we'll make lines that put a crease through a single point.
	// Finally, we'll do lines that put a crease through both points.

	// Priority can be customized since v4.2, and the default priority is changed to 2376541 instead.
	// Switching the priority of 2 and 3 has two benefits:
	// (1) It will more likely to give pinch marks rather than a whole line.
	// (2) It is more likely to come up with traditionally known folding sequences.

	for(int sAxiom: Shared::sAxioms) {
		if(sAxiom == 0 || sAxiom > 7) continue; // skip
		RefBase::logics[sAxiom]->MakeAll(arank);
	}

	// Having constructed all lines in the buffer, add them to the main collection.
	sBasisLines.FlushBuffer(arank);

	// construct all types of marks of the given rank
	RefBase::logics[RefBase::RefType::MARK_INTERSECTION]->MakeAll(arank);
	sBasisMarks.FlushBuffer(arank);

	// if we're reporting status, say how many we constructed.
	if(ShowProgress(DATABASE_RANK_COMPLETE, arank)) throw EXC_HALT();
}

bool ReferenceFinder::ImportDatabase() {
	if(!Shared::useDatabase || Shared::forceRebuild) return false;
	Shared::sDatabaseStatusSkip = 100000;

	ifstream inFile(db_path);
	if(!inFile) return false;

	BinaryInputStream is(inFile);

	sBasisLines.Rebuild();
	sBasisMarks.Rebuild();
	sCurRank = Shared::sMaxRank;

	index_t lines;
	index_t marks;
	is.read(lines).read(marks);
	cout << "lines: " << lines << ", marks: " << marks << endl;

	sBasisLines.reserve(lines);
	sBasisMarks.reserve(marks);

	while(sBasisLines.size() < lines || sBasisMarks.size() < marks) {
		unsigned char type;
		is.read(type);

		if(type > RefBase::RefType::MARK_INTERSECTION) {
			cout << "Error importing database. Data corrupted." << endl;
			return false;
		}
		RefBase *ref = RefBase::logics[type]->Import(is);
		if(ref->IsLine()) {
			sBasisLines.push_back((RefLine *)ref);
		} else {
			sBasisMarks.push_back((RefMark *)ref);
		}
		CheckDatabaseStatus();
	}
	ShowProgress(DATABASE_READY, sCurRank);
	return true;
}

/*****
Create all marks and lines sequentially.
*****/
void ReferenceFinder::BuildAndExportDatabase() {
	Shared::sDatabaseStatusSkip = 800000;
	Shared::CheckDatabaseStatus = &CheckDatabaseStatus;

	if(!Shared::use_division) {
		RefBase::ptrToHash = &RefBase::hash;
		RefBase::ptrToEquals = &RefBase::equals;
	}

	ofstream *outFile = nullptr;
	if(Shared::useDatabase) {
		outFile = new ofstream(db_path);
		if(!*outFile) {
			Shared::useDatabase = false;
			outFile = nullptr;
		} else {
			Shared::dbStream = new BinaryOutputStream(*outFile);
			*Shared::dbStream << (index_t)0 << (index_t)0;
		}
	}

	// Start by clearing out any old marks or lines; this is so we can restart if we want.
	// Edit: We add the old marks and lines back in when the user requests additional reference points/lines.
	sBasisLines.Rebuild();
	sBasisMarks.Rebuild();

	// Let the user know that we're initializing and what operations we're using.
	ShowProgress(DATABASE_INITIALIZING, 0);

	// Build a bunch of marks of successively higher rank. Note that building
	// lines up to rank 4 and marks up to rank 8 with no limits would result in
	// 4185 lines and 1,090,203 marks, which would take about 60 MB of memory.

	Paper &sPaper = Shared::sPaper;

	// Rank 0: Original references and existing ones
	{
		// Construct the four edges of the square.
		vector<RefLine *> orgLines; // To avoid accessing the buffer of sBasisLines
		orgLines.push_back(new RefLine_Original(sPaper.mBottomEdge, 0, string("s")));
		orgLines.push_back(new RefLine_Original(sPaper.mLeftEdge, 0, string("w")));
		orgLines.push_back(new RefLine_Original(sPaper.mRightEdge, 0, string("e")));
		orgLines.push_back(new RefLine_Original(sPaper.mTopEdge, 0, string("n")));

		// Construct the four corners of the square.
		sBasisMarks.Add(new RefMark_Original(sPaper.mBotLeft, 0, string("sw")));
		sBasisMarks.Add(new RefMark_Original(sPaper.mBotRight, 0, string("se")));
		sBasisMarks.Add(new RefMark_Original(sPaper.mTopLeft, 0, string("nw")));
		sBasisMarks.Add(new RefMark_Original(sPaper.mTopRight, 0, string("ne")));

		// Add existing points and lines
		for(const auto &mark: Shared::existingMarks) {
			sBasisMarks.Add(new RefMark_Original(mark, 0, string("_")));
		}
		for(const auto &line: Shared::existingLines) {
			// In theory, these won't be the sheet boundaries
			orgLines.push_back(new RefLine_Original(line, 0, string("_")));
		}

		for(auto &l: orgLines) sBasisLines.Add(l); // Add to buffer

		// Also add all intersections of existing lines
		const int n = orgLines.size();
		for(int i = 4; i < n; i++) { // At least one of the lines must be from user input
			for(int j = 0; j < i; j++) {
				RefMark_Intersection rmi(orgLines[i], orgLines[j]);
				if(rmi.mKey == 0) continue; // no intersection
				RefMark_Original rmo(rmi.p, 0, string("_"));
				sBasisMarks.AddCopyIfValidAndUnique(rmo);
			}
		}

		// Flush the buffers.
		sBasisLines.FlushBuffer(0);
		sBasisMarks.FlushBuffer(0);
	}

	// Report our status for rank 0.
	ShowProgress(DATABASE_RANK_COMPLETE, 0);

	// Rank 1: Construct the two diagonals.
	{
		// We need to pay attention that existing lines may already include them
		RefLine_Original d1(sPaper.mUpwardDiagonal, 1, string("sw_ne"));
		RefLine_Original d2(sPaper.mDownwardDiagonal, 1, string("nw_se"));
		sBasisLines.AddCopyIfValidAndUnique(d1);
		sBasisLines.AddCopyIfValidAndUnique(d2);

		// Flush the buffers.
		sBasisLines.FlushBuffer(1);
		sBasisMarks.FlushBuffer(1);
	}

	// Now build the rest, one rank at a time, starting with rank 1. This can
	// be terminated by a EXC_HALT if the user cancelled during the callback.
	try {
		for(rank_t irank = 1; irank <= Shared::sMaxRank; irank++) {
			MakeAllMarksAndLinesOfRank(irank);

			// Unlikely, but check if disk space is OK
			if(Shared::useDatabase && !*outFile) {
				cout << "Saving database failed. Insufficient disk space." << endl;
				Shared::useDatabase = false;
			}
		}
	} catch(EXC_HALT) {
		sBasisLines.FlushBuffer(sCurRank);
		sBasisMarks.FlushBuffer(sCurRank);
	}

	// Conclude database exporting
	if(Shared::useDatabase) {
		outFile->seekp(0, ios::beg);
		*Shared::dbStream << (index_t)sBasisLines.size() << (index_t)sBasisMarks.size();
		outFile->close();
	}
	delete Shared::dbStream;
	delete outFile;

	// Once that's done, all the objects are in the sortable arrays and we can
	// free up the memory used by the maps.
	sBasisLines.ClearMaps();
	sBasisMarks.ClearMaps();

	// And perform a final update of progress.
	ShowProgress(DATABASE_READY, sCurRank);
}

/*****
In some cases, it is possible for essentially identical solutions to show up,
because they are numerically different due to floating error,
and are coincidentally placed in different buckets in the container.
We use this function to perform a quick checking for such cases,
to ensure the displayed solutions are all essentially different.
*****/
template <class T>
void fillBestSolutions(vector<T *> &v, vector<T *> &temp, short num) {
	v.resize(0);
	v.reserve(num);
	for(auto &ref: temp) {
		int i = 0;
		for(; i < v.size(); i++) {
			if(ref->DistanceTo(v[i]) < EPS) break;
		}
		if(i == v.size()) {
			if(i < num) v.push_back(ref);
		} else {
			if(ref->mScore < v[i]->mScore) v[i] = ref;
		}
	}
}

/**********
Ori Studio patch — see third_party/reference-finder/README.treemaker.md, "Local changes".

Upstream's FindBestMarks/FindBestLines run partial_sort_copy over every basis
reference with CompareRankAndError, whose operator() recomputes DistanceTo() for
both operands of every comparison — and, for lines with sLineWorstCaseError set,
each DistanceTo() clips both lines to the paper before measuring, re-clipping the
constant target every time. A rank-6 line query spent ~50 of its ~63 ms there.

The searches below give the same answers: the same partial_sort_copy, over the
same sequence, under the same rank-within-good-enough rule — but each reference
is scored once per query (SearchCache::scores), each basis line's paper clip is computed
once per database (SearchCache::clips), and GetRank(), which upstream evaluates
recursively on demand, is cached alongside. Distances are evaluated by the very
functions upstream used (RefLine::WorstCaseDistance, RefMark::DistanceTo), so the
doubles the comparator sees are bit-identical. The scratch and the per-database
tables are rebuilt whenever a container's size differs from theirs, which is the
only way the database changes after the build.
**********/
namespace {

/** Where a basis line leaves the paper, or `valid == false` when it misses it. */
struct LineClip {
	XYPt a;
	XYPt b;
	bool valid;
};

/** Per-database tables for one container, parallel to it. */
template <class R>
struct SearchCache {
	std::vector<rank_t> ranks;
	std::vector<LineClip> clips; // lines only; empty for marks
	/** This query's distance from the target, per reference. */
	std::vector<double> scores;
	/** `0 .. n-1`: the container's order, which the partial sort walks. */
	std::vector<index_t> order;
};

SearchCache<RefMark> sMarkSearch;
SearchCache<RefLine> sLineSearch;

/** CompareRankAndError, read off the cached distances and ranks. */
template <class R>
class CompareCachedRankAndError {
  public:
	const SearchCache<R> &mCache;
	explicit CompareCachedRankAndError(const SearchCache<R> &cache): mCache(cache) {};
	bool operator()(index_t i1, index_t i2) const {
		double d1 = mCache.scores[i1];
		double d2 = mCache.scores[i2];

		bool notBothGood = d1 > Shared::sGoodEnoughError || d2 > Shared::sGoodEnoughError;
		if(notBothGood && d1 != d2) return d1 < d2;

		rank_t rank1 = mCache.ranks[i1];
		rank_t rank2 = mCache.ranks[i2];
		if(notBothGood) return rank1 < rank2; // we must have d1 == d2 here
		if(rank1 == rank2) return d1 < d2;
		return rank1 < rank2;
	};
};

/** The rank of every reference, once per database. */
template <class R>
void EnsureRanks(const std::vector<R *> &refs, SearchCache<R> &cache) {
	const size_t n = refs.size();
	if(cache.ranks.size() == n) return;
	cache.ranks.resize(n);
	cache.order.resize(n);
	for(size_t i = 0; i < n; i++) {
		cache.ranks[i] = refs[i]->GetRank();
		cache.order[i] = static_cast<index_t>(i);
	}
}

/** Where every basis line leaves the paper, once per database. */
void EnsureLineClips(const std::vector<RefLine *> &lines, SearchCache<RefLine> &cache) {
	const size_t n = lines.size();
	if(cache.clips.size() == n) return;
	cache.clips.resize(n);
	for(size_t i = 0; i < n; i++) {
		LineClip &clip = cache.clips[i];
		clip.valid = Shared::sPaper.ClipLine(lines[i]->l, clip.a, clip.b);
	}
}

/**
The best `temp.size()` references by this query's cached scores, in the order
partial_sort_copy over the whole container gives them.
*/
template <class R>
void SelectBestByScore(const std::vector<R *> &refs, SearchCache<R> &cache, std::vector<R *> &temp) {
	std::vector<index_t> best(temp.size());
	auto end = partial_sort_copy(cache.order.begin(), cache.order.end(), best.begin(), best.end(), CompareCachedRankAndError<R>(cache));
	temp.resize(static_cast<size_t>(end - best.begin()));
	for(size_t i = 0; i < temp.size(); i++) temp[i] = refs[best[i]];
}

} // namespace

/*****
Find the best marks closest to a given point ap, storing the results in the vector vm.
*****/
void ReferenceFinder::FindBestMarks(const XYPt &ap, vector<RefMark *> &vm, short numMarks) {
	EnsureRanks<RefMark>(sBasisMarks, sMarkSearch);
	const size_t n = sBasisMarks.size();
	sMarkSearch.scores.resize(n);
	for(size_t i = 0; i < n; i++) sMarkSearch.scores[i] = sBasisMarks[i]->DistanceTo(ap);
	vector<RefMark *> temp(numMarks * 3);
	SelectBestByScore<RefMark>(sBasisMarks, sMarkSearch, temp);
	fillBestSolutions(vm, temp, numMarks);
}

/*****
Find the best lines closest to a given line al, storing the results in the vector vl.
*****/
void ReferenceFinder::FindBestLines(const XYLine &al, vector<RefLine *> &vl, short numLines) {
	EnsureRanks<RefLine>(sBasisLines, sLineSearch);
	const size_t n = sBasisLines.size();
	sLineSearch.scores.resize(n);
	if(Shared::sLineWorstCaseError) {
		EnsureLineClips(sBasisLines, sLineSearch);
		// The target's clip, once; then each line against it exactly as
		// RefLine::DistanceTo does, from the clip computed when the cache was built.
		XYPt ta;
		XYPt tb;
		const bool targetValid = Shared::sPaper.ClipLine(al, ta, tb);
		for(size_t i = 0; i < n; i++) {
			const LineClip &clip = sLineSearch.clips[i];
			sLineSearch.scores[i] = clip.valid && targetValid ? RefLine::WorstCaseDistance(clip.a, clip.b, ta, tb) : 1 / EPS;
		}
	} else {
		for(size_t i = 0; i < n; i++) sLineSearch.scores[i] = sBasisLines[i]->DistanceTo(al);
	}
	vector<RefLine *> temp(numLines * 3);
	SelectBestByScore<RefLine>(sBasisLines, sLineSearch, temp);
	fillBestSolutions(vl, temp, numLines);
}

/*****
Return true if ap is a valid mark. Return an error message if it isn't.
*****/
bool ReferenceFinder::ValidateMark(const XYPt &ap, string &err) {
	Paper &sPaper = Shared::sPaper;
	if(ap.x < 0 || ap.x > sPaper.mWidth) {
		stringstream ss;
		ss << "x coordinate should lie between 0 and " << sPaper.mWidth;
		err = ss.str();
		return false;
	}

	if(ap.y < 0 || ap.y > sPaper.mHeight) {
		stringstream ss;
		ss << "y coordinate should lie between 0 and " << sPaper.mHeight;
		err = ss.str();
		return false;
	}
	return true;
}

/*****
Validate the two entered points that define the line. Return an error message
if they aren't distinct.
*****/
bool ReferenceFinder::ValidateLine(const XYPt &ap1, const XYPt &ap2, string &err) {
	if((ap1 - ap2).Mag() > EPS) return true;
	stringstream ss;
	ss.precision(10);
	ss << "The two points must be distinct (separated by at least " << EPS << ").";
	err = ss.str();
	return false;
}

/*****
Compute statistics on the accuracy of the current set of marks for a randomly
chosen set of points and pass the results in our static string variable.
*****/
void ReferenceFinder::CalcStatistics() {
	bool cancel = false;
	if(sStatisticsFn) {
		sStatisticsFn(StatisticsInfo(STATISTICS_BEGIN), sStatisticsUserData, cancel);
	}

	Optimizer::OptimizeMarks();
	Paper &sPaper = Shared::sPaper;

	// Run a bunch of test cases on random points.
	for(int i = 0; i < Shared::sNumTrials; i++) {
		XYPt testPt((double(rand()) / RAND_MAX * sPaper.mWidth), double(rand()) / RAND_MAX * sPaper.mHeight);
		double error = Optimizer::GetBestError(testPt);

		// Report progress, and check for early termination from user
		if(sStatisticsFn) {
			sStatisticsFn(StatisticsInfo(STATISTICS_WORKING, i, error), sStatisticsUserData, cancel);
			if(cancel) break;
		}
	}

	// Call the callback for the final time, passing the string containing the
	// results.
	if(sStatisticsFn) {
		sStatisticsFn(StatisticsInfo(STATISTICS_DONE), sStatisticsUserData, cancel);
	}
}
