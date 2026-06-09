// Standalone OpenCV HoughLinesP CPU-source tracer.
//
// This diagnostic tool is derived from OpenCV's CPU HoughLinesP implementation
// in modules/imgproc/src/hough.cpp, especially HoughLinesProbabilistic.
// OpenCV is distributed under the Apache 2.0 license:
// https://github.com/opencv/opencv/blob/4.x/LICENSE
//
// This file is not product runtime. It exists to distinguish a Rust-port bug
// from platform/libm/source-behavior differences while debugging parity.

#include <cmath>
#include <cctype>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {

struct Point {
    int x = 0;
    int y = 0;
};

struct Segment {
    int x1 = 0;
    int y1 = 0;
    int x2 = 0;
    int y2 = 0;
};

struct AcceptedTrace {
    int output_index = 0;
    int remaining_count_before = 0;
    int random_index = 0;
    Point seed;
    int max_theta_index = 0;
    int max_votes = 0;
    Point start;
    Point end;
    Segment segment;
};

struct Mask {
    int width = 0;
    int height = 0;
    std::vector<unsigned char> data;
};

struct Args {
    std::string mask_path;
    float rho = 1.0f;
    float theta = static_cast<float>(M_PI / 720.0);
    int threshold = 10;
    int min_line_length = 6;
    int max_line_gap = 4;
    int lines_max = INT32_MAX;
};

struct OpenCvRng {
    uint64_t state;

    explicit OpenCvRng(uint64_t initial) : state(initial ? initial : 0xffffffffULL) {}

    unsigned next() {
        state = static_cast<uint64_t>(static_cast<unsigned>(state)) * 4164903690U +
                static_cast<unsigned>(state >> 32);
        return static_cast<unsigned>(state);
    }

    int uniform(int a, int b) {
        return a == b ? a : static_cast<int>(next() % static_cast<unsigned>(b - a) + a);
    }
};

int cvRound(double value) {
    return static_cast<int>(lrint(value));
}

int cvRound(float value) {
    return static_cast<int>(lrintf(value));
}

int cvFloor(double value) {
    return static_cast<int>(std::floor(value));
}

int computeNumangle(double min_theta, double max_theta, double theta_step) {
    int numangle = cvFloor((max_theta - min_theta) / theta_step) + 1;
    if (numangle > 1 && std::fabs(M_PI - (numangle - 1) * theta_step) < theta_step / 2) {
        --numangle;
    }
    return numangle;
}

std::vector<std::string> readTokens(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        throw std::runtime_error("failed to open " + path);
    }
    std::vector<std::string> tokens;
    std::string token;
    char ch;
    while (in.get(ch)) {
        if (std::isspace(static_cast<unsigned char>(ch))) {
            if (!token.empty()) {
                tokens.push_back(token);
                token.clear();
            }
            if (tokens.size() == 4) {
                break;
            }
            continue;
        }
        if (ch == '#') {
            if (!token.empty()) {
                tokens.push_back(token);
                token.clear();
            }
            std::string ignored;
            std::getline(in, ignored);
            continue;
        }
        token.push_back(ch);
    }
    if (!token.empty() && tokens.size() < 4) {
        tokens.push_back(token);
    }
    return tokens;
}

Mask readPgm(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        throw std::runtime_error("failed to open " + path);
    }

    auto next_token = [&]() {
        std::string token;
        char ch;
        while (in.get(ch)) {
            if (std::isspace(static_cast<unsigned char>(ch))) {
                if (!token.empty()) {
                    return token;
                }
                continue;
            }
            if (ch == '#') {
                std::string ignored;
                std::getline(in, ignored);
                if (!token.empty()) {
                    return token;
                }
                continue;
            }
            token.push_back(ch);
        }
        return token;
    };

    const std::string magic = next_token();
    if (magic != "P5") {
        throw std::runtime_error("unsupported PGM magic: " + magic);
    }
    Mask mask;
    mask.width = std::stoi(next_token());
    mask.height = std::stoi(next_token());
    const int max_value = std::stoi(next_token());
    if (max_value != 255) {
        throw std::runtime_error("unsupported PGM max value");
    }
    in >> std::ws;
    mask.data.resize(static_cast<size_t>(mask.width) * static_cast<size_t>(mask.height));
    in.read(reinterpret_cast<char*>(mask.data.data()), static_cast<std::streamsize>(mask.data.size()));
    if (in.gcount() != static_cast<std::streamsize>(mask.data.size())) {
        throw std::runtime_error("short PGM data");
    }
    return mask;
}

struct HoughTrace {
    std::vector<Segment> segments;
    std::vector<AcceptedTrace> accepted;
};

HoughTrace houghLinesPTrace(
    const Mask& image,
    float rho,
    float theta,
    int threshold,
    int lineLength,
    int lineGap,
    int linesMax
) {
    const float irho = 1.0f / rho;
    OpenCvRng rng(UINT64_MAX);
    const int width = image.width;
    const int height = image.height;
    const int numangle = computeNumangle(0.0, M_PI, theta);
    const int numrho = cvRound(((width + height) * 2 + 1) / rho);

    std::vector<int> accum(static_cast<size_t>(numangle) * static_cast<size_t>(numrho), 0);
    std::vector<unsigned char> mask(static_cast<size_t>(width) * static_cast<size_t>(height), 0);
    std::vector<float> trigtab(static_cast<size_t>(numangle) * 2);
    for (int n = 0; n < numangle; n++) {
        trigtab[static_cast<size_t>(n) * 2] = static_cast<float>(std::cos(static_cast<double>(n) * theta) * irho);
        trigtab[static_cast<size_t>(n) * 2 + 1] = static_cast<float>(std::sin(static_cast<double>(n) * theta) * irho);
    }

    std::vector<Point> nzloc;
    for (int y = 0; y < height; y++) {
        for (int x = 0; x < width; x++) {
            const size_t idx = static_cast<size_t>(y) * width + x;
            if (image.data[idx]) {
                mask[idx] = 1;
                nzloc.push_back(Point{x, y});
            }
        }
    }

    std::vector<Segment> lines;
    std::vector<AcceptedTrace> accepted;
    int count = static_cast<int>(nzloc.size());
    for (; count > 0; count--) {
        const int remaining_count_before = count;
        const int idx = rng.uniform(0, count);
        int max_val = threshold - 1;
        int max_n = 0;
        Point point = nzloc[static_cast<size_t>(idx)];
        Point line_end[2];
        const int i = point.y;
        const int j = point.x;
        int xflag;
        int64_t x0, y0, dx0, dy0;
        const int shift = 16;

        nzloc[static_cast<size_t>(idx)] = nzloc[static_cast<size_t>(count - 1)];
        if (!mask[static_cast<size_t>(i) * width + j]) {
            continue;
        }

        for (int n = 0; n < numangle; n++) {
            const float* ttab = trigtab.data();
            int r = cvRound(j * ttab[n * 2] + i * ttab[n * 2 + 1]);
            r += (numrho - 1) / 2;
            int& value = accum[static_cast<size_t>(n) * numrho + r];
            int val = ++value;
            if (max_val < val) {
                max_val = val;
                max_n = n;
            }
        }

        if (max_val < threshold) {
            continue;
        }

        const float* ttab = trigtab.data();
        const float a = -ttab[max_n * 2 + 1];
        const float b = ttab[max_n * 2];
        x0 = j;
        y0 = i;
        if (std::fabs(a) > std::fabs(b)) {
            xflag = 1;
            dx0 = a > 0 ? 1 : -1;
            dy0 = cvRound(b * (1 << shift) / std::fabs(a));
            y0 = (y0 << shift) + (1 << (shift - 1));
        } else {
            xflag = 0;
            dy0 = b > 0 ? 1 : -1;
            dx0 = cvRound(a * (1 << shift) / std::fabs(b));
            x0 = (x0 << shift) + (1 << (shift - 1));
        }

        for (int k = 0; k < 2; k++) {
            int gap = 0;
            int64_t x = x0;
            int64_t y = y0;
            int64_t dx = dx0;
            int64_t dy = dy0;
            if (k > 0) {
                dx = -dx;
                dy = -dy;
            }
            for (;; x += dx, y += dy) {
                int64_t i1;
                int64_t j1;
                if (xflag) {
                    j1 = x;
                    i1 = y >> shift;
                } else {
                    j1 = x >> shift;
                    i1 = y;
                }
                if (j1 < 0 || j1 >= width || i1 < 0 || i1 >= height) {
                    break;
                }
                unsigned char* mdata = mask.data() + static_cast<size_t>(i1) * width + j1;
                if (*mdata) {
                    gap = 0;
                    line_end[k].y = static_cast<int>(i1);
                    line_end[k].x = static_cast<int>(j1);
                } else if (++gap > lineGap) {
                    break;
                }
            }
        }

        const bool good_line =
            std::abs(line_end[1].x - line_end[0].x) >= lineLength ||
            std::abs(line_end[1].y - line_end[0].y) >= lineLength;

        for (int k = 0; k < 2; k++) {
            int64_t x = x0;
            int64_t y = y0;
            int64_t dx = dx0;
            int64_t dy = dy0;
            if (k > 0) {
                dx = -dx;
                dy = -dy;
            }
            for (;; x += dx, y += dy) {
                int64_t i1;
                int64_t j1;
                if (xflag) {
                    j1 = x;
                    i1 = y >> shift;
                } else {
                    j1 = x >> shift;
                    i1 = y;
                }
                unsigned char* mdata = mask.data() + static_cast<size_t>(i1) * width + j1;
                if (*mdata) {
                    if (good_line) {
                        for (int n = 0; n < numangle; n++) {
                            int r = cvRound(j1 * ttab[n * 2] + i1 * ttab[n * 2 + 1]);
                            r += (numrho - 1) / 2;
                            accum[static_cast<size_t>(n) * numrho + r]--;
                        }
                    }
                    *mdata = 0;
                }
                if (i1 == line_end[k].y && j1 == line_end[k].x) {
                    break;
                }
            }
        }

        Segment segment{line_end[0].x, line_end[0].y, line_end[1].x, line_end[1].y};
        if (good_line) {
            accepted.push_back(AcceptedTrace{
                static_cast<int>(lines.size()),
                remaining_count_before,
                idx,
                point,
                max_n,
                max_val,
                line_end[0],
                line_end[1],
                segment,
            });
            lines.push_back(segment);
            if (static_cast<int>(lines.size()) >= linesMax) {
                return HoughTrace{lines, accepted};
            }
        }
    }

    return HoughTrace{lines, accepted};
}

Args parseArgs(int argc, char** argv) {
    Args args;
    for (int i = 1; i < argc; i++) {
        std::string key = argv[i];
        auto value = [&]() -> std::string {
            if (i + 1 >= argc) {
                throw std::runtime_error("missing value for " + key);
            }
            return argv[++i];
        };
        if (key == "--mask") {
            args.mask_path = value();
        } else if (key == "--rho") {
            args.rho = std::stof(value());
        } else if (key == "--theta") {
            args.theta = std::stof(value());
        } else if (key == "--threshold") {
            args.threshold = std::stoi(value());
        } else if (key == "--min-line-length") {
            args.min_line_length = cvRound(std::stod(value()));
        } else if (key == "--max-line-gap") {
            args.max_line_gap = cvRound(std::stod(value()));
        } else if (key == "--lines-max") {
            args.lines_max = std::stoi(value());
        } else {
            throw std::runtime_error("unknown argument: " + key);
        }
    }
    if (args.mask_path.empty()) {
        throw std::runtime_error("--mask is required");
    }
    return args;
}

void writePoint(std::ostream& out, const Point& point) {
    out << "{\"x\":" << point.x << ",\"y\":" << point.y << "}";
}

void writeSegmentArray(std::ostream& out, const Segment& segment) {
    out << "[" << segment.x1 << "," << segment.y1 << "," << segment.x2 << "," << segment.y2 << "]";
}

void writeSegmentObject(std::ostream& out, const Segment& segment) {
    out << "{\"x1\":" << segment.x1 << ",\"y1\":" << segment.y1
        << ",\"x2\":" << segment.x2 << ",\"y2\":" << segment.y2 << "}";
}

}  // namespace

int main(int argc, char** argv) {
    try {
        const Args args = parseArgs(argc, argv);
        const Mask mask = readPgm(args.mask_path);
        const auto trace = houghLinesPTrace(
            mask,
            args.rho,
            args.theta,
            args.threshold,
            args.min_line_length,
            args.max_line_gap,
            args.lines_max
        );
        std::cout << "{\"segments\":[";
        for (size_t i = 0; i < trace.segments.size(); i++) {
            if (i) {
                std::cout << ",";
            }
            writeSegmentArray(std::cout, trace.segments[i]);
        }
        std::cout << "],\"accepted\":[";
        for (size_t i = 0; i < trace.accepted.size(); i++) {
            const auto& accepted = trace.accepted[i];
            if (i) {
                std::cout << ",";
            }
            std::cout << "{\"output_index\":" << accepted.output_index
                      << ",\"remaining_count_before\":" << accepted.remaining_count_before
                      << ",\"random_index\":" << accepted.random_index
                      << ",\"seed\":";
            writePoint(std::cout, accepted.seed);
            std::cout << ",\"max_theta_index\":" << accepted.max_theta_index
                      << ",\"max_votes\":" << accepted.max_votes
                      << ",\"start\":";
            writePoint(std::cout, accepted.start);
            std::cout << ",\"end\":";
            writePoint(std::cout, accepted.end);
            std::cout << ",\"segment\":";
            writeSegmentObject(std::cout, accepted.segment);
            std::cout << "}";
        }
        std::cout << "]}\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "error: " << error.what() << "\n";
        return 1;
    }
}
